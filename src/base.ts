import EventEmitter from "events"

export type Handler = (data: any) => void | Promise<void>
export type Disposer = () => void

interface INode {
  pid: string
  send: (name: string, data: any) => void
  emit: (name: string, ...args: any[]) => void
  call: (name: string, ...args: any[]) => Promise<any>
}

export type Instance<T = any> = INode & T

interface IFunc {
  handler: (...args: any[]) => any | Promise<any>
  response: boolean
}

interface IRequest {
  timer: NodeJS.Timeout
  resolve: (data: any) => void
  reject: (err: any) => void
}

export interface IpcOptions {
  callTimeout?: number
}

export abstract class BaseIpc<T = any> {
  public nodes: Map<string, Instance<T>> = new Map()
  public timeout: number

  protected methods: Map<string, IFunc> = new Map()
  protected emiter: EventEmitter = new EventEmitter()
  protected disposers: Set<Disposer> = new Set()
  protected requests: Map<string, IRequest> = new Map()

  constructor (public pid: string, options?: IpcOptions) {
    this.timeout = options?.callTimeout || 100
  }

  public abstract connect(...args: any[]): void

  public close() {
    this.disposers.forEach((disposer) => disposer())
  }

  public on(event: "connect" | "disconnect", handler: (node: Instance<T>) => void): Disposer
  public on(event: string, handler: (node: Instance<T>, data: any) => void): Disposer
  public on(event: string, handler: (...args: any[]) => void): Disposer {
    this.emiter.on(event, handler)
    const disposer = () => {
      this.emiter.off(event, handler)
      this.disposers.delete(disposer)
    }
    this.disposers.add(disposer)
    return disposer
  }


  public declare(name: string, handler: any, response = true) {
    if (["emit", "call", "send"].includes(name)) {
      throw new Error(`Method name "${name}" is not allowed`)
    }
    this.methods.set(name, { handler, response })
  }

  public call(pid: string, name: string, ...args: any[]) {
    const node = this.nodes.get(pid)
    if (!node) {
      throw new Error(`Cannot call ${name} - process with id ${pid} not found`)
    }
    return node.call(name, ...args)
  }

  public emit(pid: string, name: string, ...args: any[]) {
    const node = this.nodes.get(pid)
    if (!node) {
      throw new Error(`Cannot emit ${name} - process with id ${pid} not found`)
    }
    node.emit(name, ...args)
  }

  public send(pid: string, event: string, data: any) {
    const node = this.nodes.get(pid)
    if (!node) {
      throw new Error(`Cannot send ${event} - process with id ${pid} not found`)
    }
    node.send(event, data)
  }

  public sendAll(event: string, data: any) {
    this.nodes.forEach((node) => node.send(event, data))
  }

  public emitAll(name: string, data: any) {
    this.nodes.forEach((node) => node.emit(name, data))
  }
}
