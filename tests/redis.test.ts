import Redis from "ioredis"
import { RedisIpc } from "../src"

const redis = new Redis("redis://127.0.0.1:6379")

interface RPC {
  sum: (a: number, b: number) => Promise<number>
  inc: (a: number) => void
}

const ipc1 = new RedisIpc<RPC>(redis, "p1", { callTimeout: 50 })
const ipc2 = new RedisIpc<RPC>(redis, "p2")
let p1count = 0

ipc1.declare("sum", (a: number, b: number) => a + b, true)
ipc2.declare("sum", (a: number, b: number) => a + b + 1)
ipc1.declare("inc", (a: number) => p1count += a, false)
ipc2.declare("inc", (a: number) => p1count += a, false)
ipc1.declare("wait", (sec: number) => new Promise((resolve) => setTimeout(resolve, sec*1000)), true)
ipc2.declare("wait", (sec: number) => new Promise((resolve) => setTimeout(resolve, sec*1000)), true)
ipc2.declare("error", (msg: string) => { throw new Error(msg) }, true)

describe("Redis IPC", () => {
  beforeAll(async () => {
    ipc1.connect()
  })

  afterAll(async () => {
    await ipc1.close()
    await redis.quit()
  })

  test("ipc1 should discover ipc2", (done) => {
    ipc1.on("connect", (node) => {
      expect(node.pid).toEqual("p2")
    })

    ipc2.on("connect", (node) => {
      expect(node.pid).toEqual("p1")
      done()
    })

    ipc2.connect()
  })

  test("ipc1 should call ipc2 sum method", async () => {
    const p2 = ipc1.nodes.get("p2")
    expect(p2).not.toBeUndefined()
    const result = await p2!.call("sum", 10, 20)
    expect(result).toEqual(31)
    const result2 = await p2!.sum(20, 30)
    expect(result2).toEqual(51)
    const result3 = await ipc1.call("p2", "sum", 13, 12)
    expect(result3).toEqual(26)
  })

  test("ipc2 should emit ipc1 inc method", (done) => {
    const p1 = ipc2.nodes.get("p1")
    expect(p1).not.toBeUndefined()
    p1!.emit("inc", 10)
    p1!.inc(11)
    ipc2.emit("p1", "inc", 12)
    setTimeout(() => {
      expect(p1count).toEqual(33)
      done()
    }, 10)
  })

  test("ipc2 should get message from ipc1", (done) => {
    const p2 = ipc1.nodes.get("p2")
    expect(p2).not.toBeUndefined()
    ipc2.on("test", (node, data) => {
      expect(node.pid).toEqual("p1")
      expect(data).toEqual("test message")
      done()
    })

    p2!.send("test", "test message")
  })

  test("ipc1 should get message from ipc2", (done) => {
    ipc1.on("test1", (node, data) => {
      expect(node.pid).toEqual("p2")
      expect(data).toEqual("test1 message")
      done()
    })

    ipc2.send("p1", "test1", "test1 message")
  })

  test("ipc1 should not get message from ipc2", (done) => {
    const mockFn = jest.fn()
    const disposer = ipc1.on("test2", mockFn)

    disposer()

    ipc2.send("p1", "test2", "test2 message")
    setTimeout(() => {
      expect(mockFn).toBeCalledTimes(0)
      done()
    }, 10)
  })

  test("ipc1 should get error on call/emit/send not existing node", () => {
    const f1 = () => ipc1.send("p3", "test", "test")
    expect(f1).toThrowError()
    const f2 = () => ipc1.call("p3", "test", "test")
    expect(f2).toThrowError()
    const f3 = () => ipc1.emit("p3", "test", "test")
    expect(f3).toThrowError()
  })

  test("ipc1 should get error on declare wrong method name", () => {
    const f4 = () => ipc1.declare("send", console.log)
    expect(f4).toThrowError()
  })

  test("ipc1 should get timeout error on call ipc2 method", (done) => {
    ipc1.call("p2", "wait", 1).catch((err) => {
      expect(err).not.toBeUndefined()
      done()
    })
  })

  test("ipc1 should get error on call ipc2 method", (done) => {
    ipc1.call("p2", "error", "test").catch((err) => {
      expect(err).toEqual("test")
      done()
    })
  })

  test("ipc1 should get error on call ipc2 method", (done) => {
    ipc1.call("p2", "error", "").catch((err) => {
      expect(err).toEqual(`Method "error": execution error`)
      done()
    })
  })

  test("ipc1 should get disconnect event from ipc2", (done) => {
    ipc1.on("disconnect", (node) => {
      expect(node.pid).toEqual("p2")
      done()
    })

    ipc2.close()
  })
})
