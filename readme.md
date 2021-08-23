# node-ipc-rpc

Internal process communication (IPC) and Remote procedure calls (RPC) service for nodes of scalable application.
Nodes discovery and communication can be handled by Redis.

# When it required?
When scaled nodes need
1. discover other instances
2. send messages to instance or all instances (broadcast)
3. call remote function on instance and get result

# Quick start

## Installation

```
npm install --save node-ipc-rpc ioredis
```

## Create IPC via Redis 

```ts
import Redis from "ioredis"
import { RedisIpc } from "node-ipc-rpc"

const redis = new Redis("redis://127.0.0.1:6379")
const pid = Date.now().toString(24)

// declare methods for all node instances
interface Methods {
  sum: (a: number, b: number) => Promise<number>
}

const ipc = new RedisIpc<Methods>(redis, pid)

ipc.declare("sum", (a: number, b: number) => a + b)

// handle instance connection
ipc.on("connect", async (node) => {
  const result = await node.sum(1, 2)
  console.log(result) // 3
})

// handle incoming messages
ipc.on("test", (node, data) => {
  console.log(data) // "message" on other instances
})

// send message to all instances (self exclusive)
ipc.sendAll("test", "message")


// gracefull shutdown
ipc.close()
```

# License
MIT
