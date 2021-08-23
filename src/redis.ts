import type * as Redis from "ioredis"

import { BaseIpc, Disposer, Instance, IpcOptions } from "./base"

interface ICallData {
  id: string
  name: string
  args: any[]
}

interface IMessageData {
  pid: string
  event: string
  data: any
}

interface IResponseData {
  requestId: string
  error: string
  data: any
}


export class RedisIpc<T> extends BaseIpc<T> {
  private pub: Redis.Redis
  private sub: Redis.Redis

  constructor(redis: Redis.Redis, pid: string, options?: IpcOptions) {
    super(pid, options)
    this.pub = redis.duplicate()
    this.sub = redis.duplicate()
  }

  public connect() {
    // remote process connect event
    let d = this.subscribe(`rp:connect`, (pid: string) => {
      const node = this.addNode(pid)
      this.nodes.forEach((n) => {
        this.publish(pid, "rp:info", this.pid)
      })
      this.emiter.emit("connect", node)
    })
    this.disposers.add(d)

    // remote process connect event
    d = this.subscribe(`rp:info`, (pid: string) => {
      if (!this.nodes.get(pid)) {
        const node = this.addNode(pid)
        this.emiter.emit("connect", node)
      }
    })
    this.disposers.add(d)

    // remote process disconnect event
    d = this.subscribe("rp:disconnect", (pid: string) => {
      const node = this.nodes.get(pid)
      if (!node) { return }
      this.nodes.delete(pid)
      this.emiter.emit("disconnect", node)
    })
    this.disposers.add(d)

    // remote process message event
    d = this.subscribe(`rp:message`, ({ pid, event, data }: IMessageData) => {
      const node = this.nodes.get(pid)
      if (!node) { return }
      this.emiter.emit(event, node, data)
    })
    this.disposers.add(d)

    // remote process call
    d = this.subscribe(`rp:call`, async ({ id, name, args }: ICallData) => {
      const method = this.methods.get(name)

      if (!method) { return}

      const [ pid, requestId ] = id.split(":")

      let data: any
      let error: any
      try {
        data = await method.handler(...args)
      } catch (err) {
        error = err.message || `Method "${name}": execution error`
      }

      if (method.response && requestId) {
        this.publish(pid, "rp:response", { requestId, error, data })
      }
    })
    this.disposers.add(d)

    // remote process response
    d = this.subscribe(`rp:response`, ({ requestId, data, error }: IResponseData) => {
      const request = this.requests.get(requestId)
      if (!request) { return }

      clearTimeout(request.timer)

      if (error) {
        request.reject(error)
      } else {
        request.resolve(data)
      }
      this.requests.delete(requestId)
    })
    this.disposers.add(d)

    this.broadcast("rp:connect", this.pid)
  }

  public subscribe(event: string, listener: (...args: any[]) => void): Disposer {
    const events = [event, `${event}:${this.pid}`]
    this.sub.subscribe(events)
    this.sub.on("message", (channel, data) => {
      if (events.includes(channel)) {
        listener(JSON.parse(data))
      }
    })
    return () => {
      this.sub.unsubscribe(events)
    }
  }

  public broadcast(event: string, data: any): void {
    this.pub.publish(event, JSON.stringify(data))
  }

  public publish(id: string, event: string, data: any): void {
    this.pub.publish(`${event}:${id}`, JSON.stringify(data))
  }

  private remoteCall(pid: string, name: string, args: any[], response: boolean) {
    const requestId = Date.now().toString(24)
    if (!response) {
      this.publish(pid, `rp:call`, { id: `${this.pid}:${requestId}`, name, args })
    } else {
      return new Promise((resolve, reject) => {

        const timer = setTimeout(() => {
          this.requests.delete(requestId)
          reject(`IPC request timeout. Process: ${this.pid}, method: ${name}`)
        }, this.timeout)

        this.requests.set(requestId, { timer, resolve, reject } )

        this.publish(pid, `rp:call`, { id: `${this.pid}:${requestId}`, name, args })
      })
    }
  }

  private addNode(pid: string) {

    const send = (event: string, data: any) => this.publish(pid, "rp:message", { pid: this.pid, event, data })
    const emit = (name: string, ...args: any[]) => this.remoteCall(pid, name, args, false)
    const call = (name: string, ...args: any[]) => this.remoteCall(pid, name, args, true)

    const methods: any = {}
    for (const [name, method] of this.methods) {
      methods[name] = (...args: any[]) => method.response ? call(name, ...args) : emit(name, ...args)
    }
    const node: Instance<T> = { pid, send, emit, call, ...methods }

    this.nodes.set(pid, node)

    return node
  }

  public async close() {
    this.broadcast("rp:disconnect", this.pid)
    super.close()
    await this.pub.quit()
    await this.sub.quit()
  }
}
