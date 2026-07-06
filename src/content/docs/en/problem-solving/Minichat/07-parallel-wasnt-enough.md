---
title: Why Was It Still Slow After Parallel Processing?
description: "Parallelizing message delivery with parallelStream didn't resolve the bottleneck. This post traces the shift from per-user calls to per-server batching, and shows when parallelization finally started to matter."
sidebar:
  order: 7
date: 2026-07-06

tags:
  - gRPC
  - Redis
  - Batch
  - Optimization
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: July 06, 2026</p>


## Background — One Message, Hundreds of Recipients

In Part 6, we introduced Target Routing as our WebSocket layer scaled out to multiple servers. Each user's connected server is stored in Redis. When a message needs to be delivered, the server checks for a local session first. If the recipient is local, the message goes through WebSocket directly. If not, the server looks up the destination in Redis and relays the message via gRPC.

When a message is sent in a chat room, it must reach every user in that room. If the room has dozens or hundreds of members, a single message triggers just as many delivery operations.


## Problem — Network Calls That Scale with User Count

Here is the delivery code from Part 6.

```java
for (Long userId : userIdsInChat) {
    WebSocketSession receiverSession = sessionManager.getSession(userId);

    if (receiverSession != null && receiverSession.isOpen()) {
        receiverSession.sendMessage(textMessage);
    } else {
        String targetServerId = redisTemplateForString.opsForValue()
                .get(USER_SERVER_KEY_PREFIX + userId);

        if (targetServerId != null && !targetServerId.equals(serverIdentifier)) {
            relayMessageViaGrpc(targetServerId, message, userId);
        }
    }
}
```

For locally connected users, delivery is straightforward — send via WebSocket.

The cost comes from remote users. For each one, the server queries Redis to find which server holds that user's session, then makes a gRPC call to relay the message.

As the number of remote users grows, the number of Redis lookups and gRPC calls grows with it.


## Initial Idea — If the Calls Are Slow, Parallelize Them

At the time, I believed the bottleneck was the network calls themselves.

Each Redis lookup and gRPC relay is independent — one user's delivery doesn't depend on another's. The call count was high, but every call could run concurrently.

My first attempt was to use `parallelStream()`. Instead of executing 200 network calls sequentially, run them all at once. The total latency should approach the duration of the slowest call.

It seemed like the obvious solution.


## Benchmark — The Improvement Was Underwhelming

I measured the performance with parallelization applied. 200 remote users, all on a single remote server.

| Metric | Avg | P95 | P99 |
|-|-|-|-|
| Redis GET × 200 | 12.5ms | 14.6ms | 18.9ms |
| gRPC relay × 200 | 23.9ms | 41.1ms | 54.6ms |
| **Total** | **36.4ms** | **55.7ms** | **70.4ms** |

Delivering a single message took 36ms on average. At P99, it reached 70ms.

Parallelization did help compared to sequential execution. But not as much as I expected. Redis and gRPC still dominated the total time.

If applying parallelism still leaves this much latency, maybe the problem isn't how fast the calls execute. Maybe it's something more fundamental.


## Reframing the Problem — The Wrong Question

I had been asking: *How can I execute these calls faster?*

`parallelStream()` was a correct answer to that question.

But what if the question itself was wrong?

What if the real question was: *Why am I making this many calls in the first place?*

```
User 1  → local2
User 2  → local2
User 3  → local2
...
User 70 → local2
User 71 → local3
...
```

If 70 users are connected to local2, I was sending 70 gRPC calls to the same server. Every relay carries the same payload. The only difference is the recipient ID.

If all 70 calls are targeting the same server, I could send one call to local2 with all 70 recipient IDs included.

In Part 6, the core insight behind Target Routing was that the destination of a message is a specific server. But the delivery code was still operating at the user level. I knew the destination was a server, yet the relay logic was still operating per user.


## Tradeoff — Execute Faster, or Reduce the Work

| Criteria | Parallel Processing | Server-side Batching |
|-|-|-|
| What it optimizes | How can we execute faster? | Why are we executing so many calls? |
| Optimization target | Execution time | Number of network calls |
| Redis | GET × N (parallel) | MGET × 1 |
| gRPC | relay × N (parallel) | bulkRelay × K (server count) |
| Implementation complexity | Low | Higher (proto changes, grouping logic) |

Parallelization optimizes execution. Batching optimizes the workload itself.


## Decision — Batch First, Then Parallelize

Batching and parallelization are not mutually exclusive. The question is which comes first.

Parallelizing 200 calls still means making 200 calls. Reducing the call count to 3 (one per server) and then parallelizing means executing 3 calls concurrently. Same technique, different effect.

I was trying to execute the wrong workload faster, instead of reducing the workload first.

The conclusion was simple: batch first. Group recipients by destination server, send one bulk relay per server, and only then parallelize across servers if necessary.


## Implementation

### Proto Change — Bulk Relay RPC

The existing `relayMessage` RPC accepts a single recipient ID. To send per-server batches, a new RPC that accepts a list of recipients was needed.

```protobuf
// Before
rpc relayMessage(RelayMessageRequest)
    returns (RelayMessageResponse);

// After
rpc relayBulkMessage(RelayBulkMessageRequest)
    returns (RelayMessageResponse);

message RelayBulkMessageRequest {
    repeated int64 recipientIds = 1;
    // senderId, chatId, content ...
}
```

The existing single-recipient RPC remains unchanged. A bulk version that accepts multiple recipient IDs was added alongside it. The bulk RPC reuses the same `RelayMessageResponse`.

### sendMessageToChatRoom — Server-level Batch Relay

The per-user loop was replaced with a classify → batch → relay pipeline.

```java
// Before
for (Long userId : userIdsInChat) {
    String targetServer = redis.get(userId);
    relayMessage(targetServer, userId, message);
}
```
```java
// After

// 1. Look up all server locations in a single call
Map<Long, String> userToServer = redis.multiGet(userIds);

// 2. Group recipients by destination server
Map<String, List<Long>> recipientsByServer =
        groupByServer(userToServer);

// 3. One relay per server
recipientsByServer.forEach((serverId, recipients) ->
        grpc.bulkRelay(serverId, recipients, message));
```

Previously, the code iterated over users and made per-user calls.

Now it resolves servers first, then groups users heading to the same server into a single request.

The unit of work shifted from User to Server. Call count now scales with the number of servers, not the number of users.


## Verification

Benchmark setup:
- Redis: localhost, single node
- gRPC receivers: started within the test (no actual WebSocket delivery — only counting received messages)
- Measured: the core network path of `sendMessageToChatRoom` (Redis lookup + gRPC relay)
- Iterations: 100 (after 10 warmup rounds)

### Scenario 1 — Per-User Calls vs Server-level Batching

200 remote users, all connected to the same server. Comparing individual calls against batched delivery.

**Per-user processing (parallelStream + individual calls)**

| Metric | Avg | P95 | P99 |
|-|-|-|-|
| Redis GET × 200 | 12.5ms | 14.6ms | 18.9ms |
| gRPC relay × 200 | 23.9ms | 41.1ms | 54.6ms |
| **Total** | **36.4ms** | **55.7ms** | **70.4ms** |

**Server-level batching (MGET + bulk relay)**

| Metric | Avg | P95 | P99 |
|-|-|-|-|
| Redis MGET × 1 | 0.36ms | 0.53ms | 0.77ms |
| gRPC Bulk × 1 | 0.83ms | 1.23ms | 1.78ms |
| **Total** | **1.2ms** | **1.8ms** | **2.5ms** |

The result was obvious. Roughly a 30× difference. Redis dropped from 12.5ms to 0.36ms (~35×). gRPC dropped from 23.9ms to 0.83ms (~29×). Reducing 200 calls to 1 translated directly into latency reduction.

The number of recipients didn't change. Parallelizing the execution: 36ms. Reducing the workload: 1.2ms.

### Scenario 2 — When Does Parallelization Start to Matter?

In Scenario 1, adding a thread pool on top of batching made no difference. With only one remote server, there was only one gRPC call — nothing to parallelize.

To test whether parallelization matters after batching, I increased the number of remote servers to 3 and varied both user count and thread pool size.

**200 remote users, 3 servers**

| Thread Pool | gRPC Avg | Total Avg |
|-|-|-|
| 1 (sequential) | 1.50ms | 1.84ms |
| 2 | 1.07ms | 1.49ms |
| 3 | 0.85ms | 1.22ms |
| 4 | 0.87ms | 1.30ms |

**500 remote users, 3 servers**

| Thread Pool | gRPC Avg | Total Avg |
|-|-|-|
| 1 (sequential) | 1.46ms | 1.98ms |
| 2 | 1.06ms | 1.59ms |
| 3 | 0.80ms | 1.35ms |
| 4 | 0.81ms | 1.37ms |

**1000 remote users, 3 servers**

| Thread Pool | gRPC Avg | Total Avg |
|-|-|-|
| 1 (sequential) | 1.49ms | 2.26ms |
| 2 | 1.09ms | 1.78ms |
| 3 | 0.83ms | 1.57ms |
| 4 | 0.82ms | 1.60ms |

Three observations.

First, the optimal thread pool size matches the server count. With 3 servers, 3 threads process all gRPC calls concurrently — total time equals the slowest single call. Adding more threads yields no further improvement because there are no additional calls to parallelize.

Second, total latency scales slowly with user count. At 200 users: 1.22ms. At 1000 users: 1.57ms. A 5× increase in users resulted in only a 29% increase in latency, because the number of network calls now scales with the number of servers, not the number of users.

Third, the benefit of parallelization grows with user count. At 200 users, sequential to parallel improved from 1.84ms to 1.22ms (34%). At 1000 users, from 2.26ms to 1.57ms (31%). As each gRPC call carries a larger payload, the cost of sequential execution becomes more visible.


## Same Pattern, Different Layer

| Post | Problem | Data Characteristic | Decision |
|-|-|-|-|
| 1 | Race Condition | Monotonically increasing (max) | Lua Script over distributed lock |
| 2 | Kafka ordering inversion | Per-topic ordering requirements differ | Partition key only for chat-message |
| 3 | Replication lag | Per-query freshness requirements differ | R/W Routing |
| 4 | Redis failure | Per-feature damage profile differs | Separate fail strategies |
| 5 | ID generation | Used as sort/comparison key | Snowflake |
| 6 | WebSocket Scale-Out | Destination is already known | Target Routing over Broadcast |
| 7 | Message relay optimization | Destination is a server, not a user | Server-level batching over per-user calls |

Parts 6 and 7 follow the same line of questioning. Part 6 decided *which server to send the message to*. Part 7 asked *why we were sending separate calls to the same server*. Identifying the destination and batching by destination are different stages of the same optimization.


## Conclusion

I started by believing that parallelization would solve the bottleneck. But the bottleneck was not CPU. It was the number of network calls. I was executing the wrong workload faster, without reducing the workload itself.

Parallelization wasn't wrong—it was simply solving the wrong problem. But what needed to shrink was not execution time, but execution count. Only after reducing the workload did parallelization begin to do its job.

