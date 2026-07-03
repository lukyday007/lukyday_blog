---
title: Why We Stopped Broadcasting WebSocket Messages
description: "As our WebSocket layer scaled out, we moved from Pub/Sub to Target Routing — and gRPC followed as a natural consequence of that decision."
sidebar:
  order: 6
date: 2026-07-02

tags:
  - WebSocket
  - gRPC
  - Scale-Out
  - Target Routing
  - Minichat
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: July 02, 2026</p>


## Background — WebSocket Sessions Live in Server Memory

Minichat uses WebSocket for real-time message delivery. When a user connects to a chat room, a persistent connection is established with one server instance, and messages are pushed through that connection.

The session is stored in the memory of the server that accepted the connection. On a single server, every session is local — routing is trivial.


## Problem — Scale-Out Breaks Locality

Once we add more servers, locality disappears. User A is connected to server-1, User B to server-2. When User A sends a message, server-1 receives it. But User B's session lives on server-2.

How do we locate the destination server, and how do we deliver the message to it?


## Initial Idea — Broadcast to Every Server

The first approach that comes to mind is Pub/Sub. Publish the message to all servers, let each server check its local sessions, and discard the message if the target user is not connected.

The problem scales linearly with the number of servers. The destination is exactly one server, but every server receives and processes the message. With 10 servers, 9 of them do unnecessary work.


## Reframing the Problem — Is This Message an Event?

This is where we stepped back and re-examined the nature of the data we were routing.

Some data belongs to every server. In Part 2, we discussed Kafka events where every consumer instance needed to process the state change. For system-wide state updates, broadcast is the correct strategy.

However, applying the same questions to chat message delivery yields different answers:

- **Does every server need to know about this message?** No. Only the server holding the recipient's session does.
- **Why are we sending it everywhere?** Because we don't know where the session is. Broadcasting is a workaround for missing location information.
- **Is this an Event or a Delivery?** It is not a system-wide state change that every node must observe. It is a payload that must reach one specific user.

A chat message has a known destination. If we can resolve where that destination is, there is no reason to fan out to every server.

What we need is not Broadcast. It is **Target Routing**.


## Tradeoff Comparison — Pub/Sub vs Target Routing

| Criteria | Pub/Sub | Target Routing |
|-|-|-|
| Delivery | All servers receive every message | Only the destination server receives it |
| Implementation complexity | Low | Higher |
| Session location tracking | Not required | Required |
| Wasted processing | Grows linearly with server count | Minimal |

Pub/Sub is simpler, but its cost grows with every server added. Target Routing introduces the complexity of session location management, but ensures only the relevant server processes each message.


## Architectural Decision — Redis Session Registry + Target Routing

We store the mapping of each user to their connected server in Redis (`ws:user:server:{userId} → serverId`). When a message needs to be delivered, the server checks for a local session first. If the recipient is connected locally, the message goes through WebSocket directly. If not, the server looks up the destination in Redis and forwards the message to that server.

Target Routing requires server-to-server communication. Chat messages are small, high-frequency payloads, which makes gRPC — with its persistent connections and binary serialization — a natural fit for the relay mechanism.


## Implementation

```java
// WebSocketHandler.java — sendMessageToChatRoom()
userIdsInChat.parallelStream().forEach(userId -> {
    WebSocketSession receiverSession = sessionManager.getSession(userId);

    if (receiverSession != null && receiverSession.isOpen()) {
        // Same server — deliver via WebSocket
        receiverSession.sendMessage(textMessage);
    }
    else {
        String targetServerId = redisTemplateForString.opsForValue()
                .get(USER_SERVER_KEY_PREFIX + userId);

        if (targetServerId != null && !targetServerId.equals(serverIdentifier)) {
            // Different server — relay via gRPC
            relayMessageViaGrpc(targetServerId, message, userId);
        }
    }
});
```

The routing decision happens here. 
- Local session → WebSocket. 
- No local session → Redis lookup → gRPC relay. 

The delivery path is determined entirely by where the recipient is connected.

### Limitations

This design assumes that the destination server is available.

If the destination server becomes unavailable or the gRPC relay fails, the message may never reach the recipient.

A common mitigation is to persist undelivered messages and fall back to FCM push notifications.


## Validation — Verifying the Routing Decision

We verified that the same message takes different delivery paths depending on where each recipient is connected.

```
[ Recipient on the same server ]

User A
    │
    ▼
chat-server-1
    │
    ▼
WebSocket
    │
    ▼
User B

---
[ Recipient on another server ]

User A
    │
    ▼
chat-server-1
    │
Redis lookup
    │
    ▼
gRPC Relay
    │
    ▼
chat-server-2
    │
    ▼
WebSocket
    │
    ▼
User C
```

**Test Environment**
- chat-server-1 (local1): port 8081, gRPC 9191
- chat-server-2 (local2): port 8082, gRPC 9192

**Connection State:**

| User | Connected To |
|-|-|
| User A | local1 |
| User B | local1 |
| User C | local2 |

When User A sends a message, User B (same server) should receive it via direct WebSocket delivery. User C (different server) should receive it via gRPC relay.

**local1 logs:**
```
Local delivery succeeded. Recipient ID: 198117270034059264
Forwarding message via gRPC. Recipient ID: 198117707709681664, Target Server: local2
```

**local2 logs:**
```
Received gRPC relay request. Sender ID: 198115577452040192
WebSocket relay succeeded. Recipient ID: 198117707709681664
```

The logs match the expected behavior.

The same message followed two different delivery paths depending on where the recipient's session was located. Local delivery stayed within the same server, while remote delivery was relayed to the destination server through gRPC.

This confirms that messages are no longer broadcast to every server. Once the recipient's location is resolved, only the destination server processes the delivery.


## Same Pattern, Different Layers

| Post | Problem | Data Characteristic | Decision |
|-|-|-|-|
| 1 | Race Condition | Monotonically increasing (max) | Lua Script over distributed lock |
| 2 | Kafka ordering inversion | Per-topic ordering requirements differ | Partition key only for chat-message |
| 3 | Replication lag | Per-query freshness requirements differ | R/W Routing |
| 4 | Redis failure | Per-feature damage profile differs | Separate fail strategies |
| 5 | ID generation | Used as sort/comparison key | Snowflake |
| 6 | WebSocket Scale-Out | Destination is already known | Target Routing over Broadcast |


## Conclusion

We abandoned Broadcast because a chat message already has a known destination — sending it to every server contradicted that characteristic. Choosing Target Routing required server-to-server communication, and gRPC was the mechanism that followed.