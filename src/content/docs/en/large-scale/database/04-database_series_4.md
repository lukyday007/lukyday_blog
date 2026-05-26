---
title: "Database Part 4 — Distributed Systems, Separating Responsibility and Decision-Making Authority"
description: "When data outgrows a single machine, the best architectural strategy is to decompose the monolith. And the essence of that decomposition is not dividing storage — it is dividing responsibility and decision-making authority."
sidebar:
  order: 10
date: 2026-05-26
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: May 26, 2026</p>

> In 2023, Discord was operating a 177-node Cassandra cluster to handle trillions of messages. Data was distributed evenly by volume, but a single channel with hundreds of thousands of concurrent users monopolized its partition. Latency spiked on the responsible node, and other channels sharing it were dragged down in cascade.
>
> In 2012, Instagram reached the limit of a single PostgreSQL database while processing 25 photos and 90 likes per second. When the company decided to distribute data across multiple servers, the first problem was not storage but ID generation. Auto-increment IDs that worked in a single database immediately caused collisions in a distributed environment.

*Reference: [Discord: How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)*  <br>
*Reference: [Instagram: Sharding & IDs at Instagram](https://instagram-engineering.com/sharding-ids-at-instagram-1cf5a71e5a5c)*

The former distributed data evenly yet collapsed under asymmetric traffic. The latter survived by solving the ID collision problem before splitting.

The same pattern plays out in organizations. As scale increases, centralized control becomes unsustainable, and distributing authority brings new challenges — much like the growing pains a corporation faces when transitioning to a divisional structure.

The following explores what a system gains — and what it loses — when a monolithic structure can no longer hold, and responsibility must be divided.


<br>

## When a Single System Becomes Saturated

Part 1 covered the cost of persistence. Part 2 explored the two-edged cost of indexes. Part 3 dealt with the tension between consistency and concurrency in transactions. All of them addressed resource contention within the confines of a single machine.

However, as a service grows, the problem itself changes. Lock strategies and index tuning are no longer sufficient. Disks fill up, memory reaches its ceiling, and the system is no longer asking *"How do I process this more efficiently?"* but rather **how to distribute the concentrated responsibility itself**.

### The Ceiling of Scale-Up

In the early days, a single server handles traffic comfortably. Keeping all data in one database is the simplest and most efficient choice — development is fast, and maintaining data consistency is straightforward. But as a service scales and users multiply, the system reaches a point where this approach simply cannot hold.

What can be done immediately to reduce the load? Upgrade the hardware. Swap in a faster CPU, add more memory. But **vertical scaling (Scale-up)** cannot continue indefinitely. Even the most expensive hardware has physical limits, and the largest cloud instances have a ceiling of their own.

But the real problem lies elsewhere. As traffic grows, the cost of funneling every request through a single database rises exponentially. Reads, writes, transactions, failure recovery — all concentrated on one machine. Like **a centralized bureaucracy** where every approval must pass through headquarters.

In this structure, a **Single Point of Failure (SPOF)** is unavoidable. No matter how powerful the server, one moment of downtime brings the entire service to an immediate halt.


### The Cost Curve of Vertical Scaling

Each step up in hardware specification does not increase cost linearly. Doubling performance costs significantly more than double the price. AWS memory-optimized instances (r6i family) illustrate this clearly — the price curve steepens sharply as specifications rise.

*   **32 GB (r6i.xlarge)**: ~$200/month
*   **64 GB (r6i.2xlarge)**: ~$363/month
*   **128 GB (r6i.4xlarge)**: ~$726/month
*   **256 GB (r6i.8xlarge)**: ~$1,452/month

Does spending more on hardware proportionally improve efficiency and reliability? Not at all. It only concentrates more responsibility onto a single point of failure.

Consider the comparison: maintaining one 128 GB server costs $726/month, while running four 32 GB servers — totaling the same 128 GB — costs $800/month. The raw numbers appear similar. However, operational complexity aside, **distributing across multiple machines offers significantly better scalability and fault tolerance**.

When this tipping point arrives, the system needs not one powerful database, but several modest ones. **Horizontal scaling (Scale-out)**.

*Reference: [AWS EC2 R6i Pricing](https://www.economize.cloud/resources/aws/pricing/ec2/family/r6i/)*  


<br>

## Why Roles Had to Be Separated

When a system approaches its breaking point, the first response is not to split data across servers. The operational complexity would be too severe. Instead, the typical starting point is to relieve the central database of its heaviest burden.

The bottleneck here is not simply volume. It is that two completely different kinds of work collide on a single machine — the executive drafting critical contracts (**writes**) while thousands of customers keep asking "Are you open?", "How much is this?", "Where's my order?" (**reads**).

### Replication — Delegating Read Authority

To reduce load efficiently, the system divides labor by role while keeping the data structure intact. This works because **read operations account for over 90% of total traffic**. Separating reads from writes immediately lifts a significant portion of the load.

The principle is straightforward: **final decision-making stays with the executive, while routine inquiries are delegated to staff**. Mutations that cannot afford to be wrong — creates, updates, deletes — are handled by a single Master. The bulk of the traffic, read requests, is distributed across multiple Replicas.


```
[Replication]

                 WRITE PATH (single source)
                             │
                             ▼
                       ┌───────────┐
                       │   MASTER  │
                       │  (write)  │
                       └─────┬─────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
    ┌───────────┐      ┌───────────┐       ┌───────────┐
    │ REPLICA 1 │      │ REPLICA 2 │       │ REPLICA 3 │
    │   (read)  │      │   (read)  │       │   (read)  │
    └─────┬─────┘      └─────┬─────┘       └─────┬─────┘
          │                  │                   │
          └──── replication lag (time delay) ────┘

                  → stale reads possible
```

### The Latency Cost of Delegation

Delegation, however, comes at a price.

Consider a scenario: a customer completes a payment at headquarters, then walks over to the information desk and asks "Can you confirm my order?" The staff replies: *"No record of that yet."* The payment was processed at headquarters (Master), but the information desk (Replica) has not yet received the update. A few seconds later, a refresh shows the order as expected.

This delay between a write landing on the Master and its propagation to Replicas is called **Replication Lag**.

### Accepting Eventual Consistency

Zero tolerance for this delay is possible. The executive confirms every staff member has received the update before moving on to the next task. Information stays perfectly synchronized in real time. But as staff grows, the executive spends more time waiting for confirmations than doing actual work. The benefit of delegation disappears.

In practice, most architectures find a pragmatic middle ground. Operations where consistency is critical — creates, updates, deletes — are forced to read directly from the Master, accepting the additional load. Reads where a few seconds of staleness are acceptable are routed to Replicas.

All servers will converge to the same state — given enough time. This is **Eventual Consistency**. It is a choice to prioritize system-wide scalability over instantaneous precision.

<br>

## Sharding — Independent Branch Offices

Replication was a good strategy — staff took over routine inquiries (Read) and relieved the executive (Master) of much of the burden. But it has a fatal limitation. Stamping contracts (Write) is still the executive's job alone, and every document in the company must fit inside **a single filing cabinet on the executive's desk (a single server's disk)**.

When writes exceed tens of thousands per second or data outgrows a single server, Replication is no longer enough. The data itself must be split across independent servers. This is **Sharding**.

The real challenge is deciding *how* to split customers across branch offices. The shard key determines query patterns, load distribution, and operational cost.

### Hash Sharding and the Loss of Order

How can data be distributed  evenly across all servers? **Hash Sharding** was designed to prevent data from piling up on a single server.

```
[ Hash Sharding ]

                 key
                  │
                  ▼
           ┌─────────────┐
           │  hash(key)  │
           └──────┬──────┘
                  │
      ┌───────────┼───────────┬───────────┐
      ▼           ▼           ▼           ▼
  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
  │ Node A │  │ Node B │  │ Node C │  │ Node D │
  └────────┘  └────────┘  └────────┘  └────────┘
      ▲
      │
  order LOST (no global ordering)
  random distribution
```

This approach distributes resources evenly and gives cost predictability — but the price is *the loss of data continuity*. Users 100 and 101, who registered moments apart, get scattered to completely different servers.

If the business requests a range query like "list of the 100 most recent signups," the system faces massive inefficiency. Data is torn apart with no ordering across servers, so every server must be queried, results collected, and re-sorted centrally. Hash sharding gains mechanical uniformity by completely sacrificing **sorted data retrieval**.

### Range Sharding and the Risk of Skew

**Range Sharding** emerged to recover the ordering and business context that hash sharding destroyed.

In practice, requirements to read data sequentially — payment records for a specific period, customer lists in alphabetical order — come up constantly. By *splitting servers by date or range*, the system only needs to visit one server and read through it in order, maximizing retrieval efficiency.

```
[ Range Sharding ]

     key range
         │
         ▼
    ┌──────────┬──────────┬──────────┬──────────┐
    │ Node A   │ Node B   │ Node C   │ Node D   │
    │ 0-25%    │ 25-50%   │ 50-75%   │ 75-100%  │
    └────┬─────┴────┬─────┴────┬─────┴────┬─────┘
         │          │          │          │
         │                                │
         │                          HOTSPOT REGION
         │                          (latest range)
         └────────────────────────────────────────▶

      skewed traffic → uneven load distribution
```

But real-world traffic is never uniform. Customers always crowd *the present* — today's orders, the latest posts, the most recent signups. With date-based range sharding, the branch office handling the current month is overwhelmed with traffic while branches holding last year's records sit idle.

Range sharding preserves order at the cost of **hotspot concentration**.

### Hot Shards and the Failure of Even Distribution

Return to the Discord case. Data volume was balanced across shards — but the traffic from a single influencer channel was overwhelming. One shard buckled under the load. This is the **Hot Shard** problem. 

Hash sharding distributed data evenly but lost ordering. 
Range sharding preserved ordering but concentrated traffic on the latest range.

Hot Shard makes the underlying problem clear: no matter how evenly data is distributed, real-world traffic is inherently uneven.

At this point, the architectural objective shifts. The question is no longer how to distribute data. It becomes **how to dissipate the concentration of requests on a single shard**.

**Composite Keys — Finer-Grained Distribution**

The most intuitive response remains within the logic of distribution. If data is clustered in one place, why not partition more finely?

By combining **a time component or numeric suffix with the existing Shard Key into a composite key**, a single massive hotspot can be fragmented across multiple shards.

```
       [ Before ]                [ After (Composite Key) ]

    Popular Post 123                 Popular Post 123         
           │                        ┌───────┼───────┐
           ▼                        ▼       ▼       ▼
      [ Shard A ]                 [A-1]   [A-2]   [A-3]

    ████████████████              █████   █████   █████
All requests concentrated     Load distributed across shards
```

This helps, but does not fully solve the problem. Finer partitioning spreads data — it does not spread user interest.

**Cache Layer — Preventing Requests from Reaching the Database**

Here, the approach changes entirely. Instead of distributing better, the goal becomes stopping requests from reaching the database at all.

By placing a **cache layer** in front of the database and holding query results for just a few seconds, tens of thousands of identical requests are absorbed before they ever touch the origin.

```
Normal operation

Requests ██████████████ ──▶ [ Cache ] ═══════════▶ Response
                           │
                           └──── few only ───▶ [ DB ]
```

However, caching introduces its own failure mode. The moment a cache entry expires, all pending requests simultaneously storm the origin database — a phenomenon known as *Cache Stampede*.

```
Cache expiration

Requests ██████████████ ──▶ [ Cache ] ── MISS ──┬──▶ [ DB ]
                                           ├──▶ [ DB ]
                                           ├──▶ [ DB ]
                                           ├──▶ [ DB ]
                                           └──▶ [ DB ]
                  Cache Stampede
```

**Request Coalescing — Reducing the Requests Themselves**

Discord's answer was more radical. Rather than handling each concurrent duplicate request individually, the system stops processing them separately altogether.

Identical requests arriving within a narrow time window are queued together, and a single query is executed. The **result is shared across all waiting requests**. Tens of thousands of request flows compressed into one operation.

```
Request A ─┐                        ┌─▶ Response A
Request B ─┼─┐                    ┌─┼─▶ Response B
Request C ─┘ │                    │ └─▶ Response C
             ├────▶ Query × 1 ────┤
Request D ─┐ │                    │ ┌─▶ Response D
Request E ─┼─┘                    └─┼─▶ Response E
Request F ─┘                        └─▶ Response F
```

Sharding is not about how evenly data is stored. It is about **how realistically the system anticipates actual request patterns**. Stable systems are built by those who partition around real traffic, not theoretical distribution.


<br>

## The Essence of Decomposition

The bottleneck caused by centralized control is not unique to databases. Large organizations face the same structural ceiling as they scale.

General Motors in the 1960s hit the same wall. As the business expanded, every decision — from minor dealership coordination to new vehicle planning — had to pass through corporate headquarters. Approvals piled up, decisions stalled. The organization was paralyzed by its own approval process.

Alfred Chandler studied this breakdown and distilled it into a single principle: **"Structure follows strategy."** If the market has outgrown the organization, the organization must be redesigned — not the executive.

*Reference: [Alfred Chandler, "Strategy and Structure" (1962)](https://en.wikipedia.org/wiki/Strategy_and_Structure)*

### The Failure of Distributed Architecture Without Distributed Authority

GM's response was to sever real-time interference from headquarters and grant each brand division full operational autonomy. Headquarters retained long-term strategy; day-to-day decisions were made independently at each division. The technical journey we have traced follows the same trajectory.

*   **Replication**: Delegating low-risk read operations — routine inquiries — to subordinate nodes while the primary retains write authority.
*   **Sharding**: Establishing independent partitions, each responsible for its own subset of data, when a single node can no longer contain the whole.

A common mistake follows. Branch offices have been opened across the country, but every customer interaction still requires a phone call to headquarters: "Check the other branch's ledger," "Get the head office stamp first." This pattern — known technically as **distributed transactions** or **distributed locks** — produces the worst of both worlds: the complexity of distribution with the latency of centralization. It is centralized architecture wearing a distributed costume.

### The Transfer of Independent Decision-Making Authority

True distribution is not about running more servers. It is about drawing service boundaries cleanly enough that **each node can handle its own customers without asking for help or permission from anyone else**.

A local branch office deciding "Headquarters will reconcile it later — for now, we can answer the customer on our own" is accepting **Eventual Consistency**. An independent branch (Shard) declaring "customers in this region are my responsibility — I stamp the contracts myself" is exercising autonomous authority. Only when each branch can act on its own does distribution deliver on its promise.

<br>

## The Bottom Line

Vertical scaling has a definitive ceiling (Scale-up). Routine workloads must be delegated downward (Replication). When the tipping point arrives, independent partitions must be established (Sharding).

The real difficulty of distribution is not technical. It begins the moment the system must tolerate slight delays, stale reads, and temporary disagreement between nodes — because authority has been delegated. The essence of distributed systems is not running more servers. It is deciding **how far decision-making authority can be independently delegated**.

Next up: The system traded strict consistency for scalability. Now it must push that trade-off further — **NoSQL** and **Cache**. What happens when a system deliberately stops demanding real-time accuracy?