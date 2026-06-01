---
title: "Database Part 6 — Distributed Transactions, The Coordination Cost That Never Left"
description: "A single-database transaction was a powerful promise. But now that systems are scattered, keeping that promise demands a separate coordination cost. The price of enforcing perfect agreement, the risk of loosening it, and the choice to defer it altogether."
sidebar:
  order: 12
date: 2026-06-01
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 1, 2026</p>

> In Part 1, persistence demanded the cost of disk I/O.
> In Part 2, indexes sold writes to buy reads.
> In Part 3, transactions negotiated between consistency and concurrency.
> In Part 4, the system dismantled centralized control and divided responsibility.
> In Part 5, it surrendered a measure of accuracy in exchange for speed and scalability.
>
> But the moment a user presses the checkout button, every trade-off from those five parts collides at once. Data must be durably written to disk. Indexes must be updated in lockstep. Inventory must hold under a flood of concurrent requests. The problem is that none of these operations live on the same server anymore. Part 4 dismantled the monolith. Part 5 loosened the guarantees. Yet payments do not tolerate "close enough." The moment a scattered system is forced to guarantee a single, unified result, costs that seemed settled come back to collect.

A Shopify payments infrastructure engineer put it plainly. "A one-in-a-million network failure happens multiple times a day at Shopify's scale." When a payment API times out, the client retries. Without safeguards, the card gets charged twice. Double charges destroy customer trust. Undetected duplicates come back as chargebacks.

In the single-database era, all state was visible from one place. **After services scattered, no single component could see the full outcome of a transaction at the same time.** The industry started to realize something uncomfortable: the cost of keeping everything in perfect agreement was far higher than the cost of the actual business logic.

This article covers the choices that followed. The price of enforcing perfect consensus. The risk of loosening it. And the option of deferring the moment of agreement altogether.

*Reference: [Shopify: 10 Tips for Building Resilient Payment Systems](https://shopify.engineering/building-resilient-payment-systems)*


<br>

## One Button, Four Transactions

For the user, a payment is a single button press. For the system, that one press is four independent transactions firing simultaneously on different servers.

```
[ User Perception ]

Checkout Button  ──────▶  Order Complete 

        One action, one result

---

[ Infrastructure Reality ]

Checkout Button
├──▶ Payment Service    (payment authorization)   ── DB A
├──▶ Order Service      (order creation)          ── DB B
├──▶ Inventory Service  (stock deduction)         ── DB C
└──▶ Coupon Service     (coupon consumption)      ── DB D

    4 services, 4 databases, 4 independent transactions
```

Each service owns its own database. Payment Service authorizes the charge. Order Service creates the record. Inventory Service deducts stock. Coupon Service marks the coupon consumed. The critical point is that these operations no longer live inside a single transaction.

*From a business perspective, this is one transaction.* A charge without an order. Stock deducted without a payment. A coupon consumed with no purchase to show for it. None of these states are acceptable. Yet structurally, four COMMITs happen **independently, on different servers, at different times**.

Now that services are separated, honoring the old promise — "all succeed or all fail" — requires paying a separate coordination cost. That cost cannot be eliminated. What differs from system to system is only *where it is paid, and in what form*.


### What a Single Machine Could Manage

In the single-database era, everything was in one place. One transaction log. One lock manager. One failure state. Operations between BEGIN and COMMIT either all succeeded or were entirely undone. The ACID guarantees from Part 3 held firmly when all state lived within a single process. There was no gap for consistency to break, no window for intermediate states to leak. *This was possible because one authority made every decision.*


### What Cannot Be Proven Across the Network

The moment the system goes distributed, that certainty breaks. Split the database across multiple machines, and transaction logs, lock managers, and failure states all become independent.

The biggest problem is visibility. When one transaction managed the entire operation, success or failure was immediately obvious — everything happened inside the same process. But whether a server on the other side of a network succeeded, failed, or is still processing — there is no way to tell. No response does not mean failure. The operation may have completed. Only the reply was lost.

**The fundamental problem of distributed systems is not computation. It is the inability to be certain.** Failure and delay look identical. Whether the other side is even alive cannot be proven. A system that must decide with incomplete information. That is what distribution actually means.


### A State That Is Neither Success Nor Failure

On a single server, the outcome was binary. Total success or total failure. In a distributed environment, a gray zone opens up between them.

Payment Service finished the card authorization. Order Service created the order. But Inventory Service timed out with no response. Coupon Service's server is down entirely. *A state that is neither success nor failure* sits independently in each service, all at the same time.

The system still has to decide. Cancel the payment? Wait for inventory? Freeze everything until the coupon server comes back? The truly dangerous thing in a distributed system is not failure. **It is not knowing whether failure happened.** "All succeed or all fail" is a clean principle. But the network does not let that cleanness come cheap.


<br>

## Safety Traded for Availability

A deal requires five signatures to close. If even one is missing, the contract is void. Nobody picks up a pen until everyone is seated at the same table. It is slow — but when a single error can cost billions, there is no other way.

### Domains Where Imprecision Is Not Forgiven

If partial failure is unavoidable in a distributed environment, why insist on **perfect consensus** at all?

Because there are domains where compromise is not an option. Interbank transfers. Card payment authorizations. Securities trades. In these businesses, slowness is forgiven. "Mostly succeeded," "largely consistent," "will be reconciled later" — these are not. When the system must halt rather than produce an incorrect result, *atomicity* is the value that cannot be negotiated.

### 2PC (Two-Phase Commit) — Rebuilding Central Approval Over Scattered Nodes

When all state was visible from one system, a single transaction manager was enough. But once services split, no single component could determine the full outcome of a transaction on its own. 

2PC is an attempt to restore a central approval authority on top of scattered nodes. **Even at the cost of delay, it forces every participant to arrive at exactly the same conclusion.**

```
[ Phase 1: Prepare ]

                                ┌──▶ Node A
Coordinator ── "Can Commit?" ───┼──▶ Node B
                                └──▶ Node C

Node A ── "READY" ──┐
Node B ── "READY" ──┼──▶ Coordinator
Node C ── "READY" ──┘
(All nodes wait at pre-commit state)
(Locks held / changes uncommitted)

---

[ Phase 2: Decision ]

All nodes READY
Coordinator ── "COMMIT" ─────────▶ All nodes

Any node fails
Coordinator ── "ROLLBACK" ───────▶ All nodes
```

The Coordinator sends a prepare request to every participating node. Each responds with whether it can commit. All must report OK for the global commit to proceed. A single failure signal rolls back everything. No node stamps its own approval unilaterally.

### The Price of Safety

The problem is that this consensus process **forces the entire system's speed to match its slowest participant**.

Every node must freeze until the Coordinator delivers its verdict. While waiting, each node holds locks on the affected data. Other requests targeting the same rows must queue until those locks release. As participants increase, the wait time stretches to match whoever is slowest.

In Part 4, the system dismantled centralized control and granted each node *independent decision-making authority*. 2PC takes that independence back. A distributed system was built — and then a powerful central coordinator reclaimed control over every decision.

*Part 4: Dismantling centralized control, independent decision-making authority*

### When the Coordinator Goes Down

Here, the Achilles' heel of 2PC surfaces. A failure of the Coordinator itself.

All nodes have sent OK in Phase 1. The Coordinator crashes before issuing the Phase 2 decision. Every node has already prepared to commit and is holding locks. The final instruction never arrives.

Commit? Roll back? Keep waiting? No node can decide on its own. None knows what the others responded. Locks are held. Every node is frozen. There is no way to determine which state the system should settle on. The entire system seizes. Every subsequent request touching that data is blocked.

**2PC restores the guarantees distribution took away — and brings back the costs that came with them.**

*Part 3: ACID, locks, isolation levels*


<br>

## Safety Traded for Isolation

Now consider the opposite. A company that requires every department head to sign off before anything ships. When there were three departments, this worked fine. When there were ten, approval wait times started exceeding actual production time.

The company changed its approach. Ship first. If something goes wrong, recall after the fact.

### The Saga Pattern — The Price of Abandoning Global Approval

If 2PC was "nobody moves until everyone agrees," Saga starts from the opposite end. It abandons the idea of a single, system-wide transaction altogether.

Instead, it breaks the monolith apart. The entire business operation is decomposed into a chain of small, locally complete transactions — one per service.

```
[ Saga — A Chain of Local Transactions ]

Order Service     ── Create Order     ── COMMIT (DB B)
    │
    ▼
Payment Service   ── Authorize Payment ── COMMIT (DB A)
    │
    ▼
Inventory Service ── Deduct Stock      ── COMMIT (DB C)
    │
    ▼
Coupon Service    ── Consume Coupon     ── COMMIT (DB D)
Each step commits only within its own DB. No global lock.

```

**Each service commits only to its own database.** Unlike 2PC, it does not wait for every other node to respond. One step finishes, the next begins. There is no global transaction — only *local ACID*, rigorously enforced at each step.

### What Happens When a Step Fails

Everything goes smoothly until the final step breaks. Coupon application fails, but the three preceding services have already committed to their own databases.

Without a global transaction, there is no single ROLLBACK to undo everything. Instead, each committed state must be reversed with a new, forward-moving transaction. This is the **Compensation Transaction**.

```
[ Saga — Compensation Transaction ]

Coupon Application Failure Detected
    │
    ▼
Inventory Service   ── Restore Stock      ── COMMIT (DB C)
    │
    ▼
Payment Service     ── Cancel Payment      ── COMMIT (DB A)
    │
    ▼
Order Service       ── Void Order          ── COMMIT (DB B)

Not a system-level rollback — a business-logic reversal built by hand.
```

Stock restoration, payment cancellation, order voiding — each runs as a separate local transaction. The database does not reverse anything automatically. **Developers build the cancellation logic themselves.** This is not a database-level *ROLLBACK*. It is closer to posting a negative entry in a ledger to offset an existing record. Recovery responsibility that once belonged to the transaction manager has moved up to the application layer.

### The Price of Scalability

Saga's advantages are clear. **Coupling between services drops. Global locks vanish.** Throughput and scalability climb. A single service going down no longer drags the entire system to a halt.

But the price is real.

Under 2PC, intermediate states stayed hidden until the final commit. Under Saga, each step commits immediately — so incomplete states are visible to other services the moment they happen. A user checks order history and sees the payment marked "processing." Inventory has been deducted, but the coupon is still active. Customer support gets a ticket: "I was charged, but my order isn't showing." Intermediate states that were invisible in the single-database era **start surfacing in the actual customer experience** once the system goes distributed.

On top of that comes the implementation cost of compensation transactions. Building the failure path is far more complex than building the happy path. At every step: "If this fails, how do we undo everything before it?"

**Isolation is partially surrendered. In return, the system gains the availability and scalability that keep it from freezing.**

*Part 3: ACID, rollback* <br>
*Part 4: Service independence*


<br>

## 2PC vs Saga

Two strategies. Same problem. Opposite answers.

**2PC**
```
Node A ──┐
Node B ──┼── All wait ──▶ Coordinator decides ──▶ Global COMMIT or ROLLBACK
Node C ──┘

Strong consistency. High coordination cost. Coordinator failure freezes everything.
```

Distributed decision-making authority is pulled back under a single approval structure. **Data consistency is gained at the cost of availability and speed.**

**Saga**
```
Step 1 ── COMMIT ──▶ Step 2 ── COMMIT ──▶ Step 3 ── COMMIT ──▶ ...
│
On failure
│
◀── Compensate 3 ◀── Compensate 2 ◀── Compensate 1

Each step commits independently. Intermediate states exposed. Failure triggers reverse compensation.
```

Each service retains its independence **at the cost of isolation and the simplicity of recovery**.

Neither is superior. The question is which form of failure the business can tolerate, and how far it is willing to pay.

<br>

## The Architecture That Abandoned Real-Time Consensus 

When there were three departments, phone calls were enough. Planning called Sales, Sales confirmed and called Logistics, Logistics confirmed and passed it along.

When the company grew to fifteen departments, the next call was already queuing before the current one finished. Eventually, the company stopped making calls altogether. Updates went on the bulletin board. Each department checked on its own time.

### The Bottleneck Built by Synchronous Chains

2PC halts everyone until consensus is reached. Saga lets each service commit independently and compensates in reverse on failure. But as long as service-to-service calls remain synchronous, a delay in one service still chokes the entire chain.

One step further: **asynchronous event-driven architecture**. The premise — not every service needs to agree on the same answer at the same moment.


### Why Event Brokers Emerged

As systems grew, another form of coordination cost emerged. 

Even after abandoning 2PC, services were still tied together through **synchronous calls**. Every step waited for the next step to respond before work could continue. The architecture looked distributed, but agreement was still being demanded in real time.

At scale, the waiting itself became the bottleneck. For these reasons, some systems stopped asking for immediate answers. Direct service-to-service calls gave way to **asynchronous messaging through event brokers** such as Kafka.

```
[ Synchronous Calls ]

  Order ──▶ Payment ──▶ Inventory ──▶ Coupon
    │
  Timeout ──▶ Entire chain blocked

---

[ Event-Driven ]

  Order ──▶ "Order Created" ──▶ ( Event Broker ) ──▶ Payment (processes at its own pace)
  ──▶ Inventory (processes at its own pace)
  ──▶ Coupon (processes at its own pace)
```

No service waits for another to finish. Each completes its own work, publishes an event, and moves on. Payment, Inventory, and Coupon **services pick up and process events at their own speed**.


### The Price of Time-Shifted Consensus 

In the synchronous model, one slow service in the chain brings every downstream request to a halt — dominoes falling. The *disguised centralization* from Part 4 reappears. The architecture looks distributed, but as long as the call chain is synchronous, the slowest service sets the pace for everything.

Asynchronous messaging severs that chain. When an order arrives, the service publishes an "Order Created" event to an event broker and returns immediately. 

The price, of course, exists. At any given instant, a window where data is temporarily out of sync will always be present. But brief misalignment in some data is a better bargain than total system paralysis. **Instantaneous consensus is surrendered. Time-shifted consensus is accepted.**

*Part 4: Disguised centralization, independent decision-making authority, distributed architecture* <br>
*Part 5: Eventual Consistency*


<br>

## The DB Wrote It but the Message Never Left

When a branch office closes a contract, two things must happen at once. The original goes into the ledger, and headquarters gets notified. The problem is when the ledger entry is written but the fax to headquarters never goes through.

The reverse is worse. If the fax goes out but the ledger entry is missing, headquarters starts processing a contract that does not exist. The fix was simple. When writing in the ledger, a copy of the notification goes into the same binder. A separate clerk checks the binder periodically and delivers to headquarters.

### Two Systems Blind to Each Other

Event-driven architecture looks like it solves the synchronous chain problem. But one particularly nasty edge case remains.

Saving data to the order database and publishing an event to Kafka are two separate operations targeting two separate systems.

```
[ DB succeeds, event fails ]

Order Service ──▶ INSERT order ──▶ COMMIT (DB) ✓
│
└──▶ Publish event ──▶ Kafka ✗ (network error)

Result: Order exists only in DB. Other services are unaware.

---

[ Event succeeds, DB fails ]

Order Service ──▶ Publish event ──▶ Kafka ✓
│
└──▶ INSERT order ──▶ COMMIT (DB) ✗ (failure)

Result: A ghost order event propagates across the system.
```

**The database and Kafka have no visibility into each other's outcome.** *The DB is responsible for its own transaction. Kafka is responsible for its own log.* Each is internally consistent. The problem is that the business treats both as a single event. If the DB commit succeeds but a network error kills the event, the order exists in one database while every other service remains oblivious. If the event publishes but the DB commit fails, a nonexistent order ripples across the entire system.


### Outbox Pattern — An Event Born Inside the DB Transaction

The Outbox pattern was designed to close this gap. The goal is simple: **bind data persistence and event creation within a single transaction**.

```
[ Outbox Pattern ]

Order Service
│
├── INSERT order data         ──┐
│                               ├──▶ Same DB, same transaction ──▶ COMMIT
└── INSERT Outbox table entry ──┘
│
▼
Separate relay process monitors the Outbox
│
▼
Forwards events to Kafka
```

When the order is saved, the event payload is also written to an Outbox table in the same database and committed together. Same DB, same transaction — local *atomicity* is guaranteed. A separate relay process then reads the Outbox table periodically and forwards entries to Kafka.

DB commit and event creation are now physically synchronized.

*Part 3: Atomicity*


### The Guarantee Gained by Giving Up Immediate Delivery

The Outbox pattern gives up immediate event delivery. What it gains instead is a different guarantee: every fact recorded in the database will eventually reach the rest of the system. The relay introduces a slight delay — a concession that ensures, at minimum, the order of events is preserved.

The *idempotency key* from the Network series payment scenario promised that "the same request, sent multiple times, executes only once." Outbox promises that "any fact recorded in the database will be delivered as an event." Both are **safeguards built to restore trust that distribution broke**. What a single transaction manager once guaranteed implicitly now has to be reimplemented explicitly — across the system. And that reimplementation is never free.

*Reference: [Stripe: Designing Robust APIs with Idempotency](https://stripe.com/blog/idempotency)* <br>
*Network Part 5: Idempotency keys, payment retries*


<br>

## The Dilemma of Distributed Transactions

Every strategy in this article paid the same cost. Only the form was different.

2PC halts all participants for **perfect consensus**. Safe — but if the coordinator goes down, the entire system freezes. Saga grants each service **independence**, but accepts intermediate state exposure and the burden of compensation logic. Event-driven architecture **severs the synchronous chain**, but must tolerate windows where data is temporarily inconsistent. Outbox **closes the gap between database and message queue**, but trades immediacy for a relay process that has to be built and operated.

No strategy eliminates the cost of coordination. Designing distributed transactions is not a technology choice. **It is a question of which failure to permit — decided first — then selecting the cost structure that fits.**

If not a single inconsistency can be tolerated, as in bank transfers, the waiting cost of 2PC must be absorbed. If temporary misalignment can be reconciled after the fact, as in e-commerce orders, Saga and event-driven architectures become the rational path.

Distributed transactions always collapse to the same question.
"Who bears this unavoidable cost?"

The disk I/O of Part 1. The index write tax of Part 2. The lock contention of Part 3. The distributed coordination of Part 4. The accuracy compromise of Part 5. All the same question. 


<br>

## The Bottom Line

When a system is broken apart and built as a distributed architecture, maintaining a single consistent state in real time demands an enormous coordination cost.

2PC sacrificed availability and speed for perfect consensus.
Saga gave up immediate consistency and isolation for service independence.
Event-driven architecture traded instantaneous agreement for throughput and scalability.
Outbox exchanged immediacy and simplicity for data integrity.

The answer was never the same twice. And it was never free.

The disk I/O of Part 1, the index write tax of Part 2, the lock contention of Part 3, the distributed coordination of Part 4, the accuracy compromise of Part 5 — every technology in this series was ultimately a means of reshaping a trade-off. Not eliminating it.

**System design is not the art of building perfection. It is the art of deciding which imperfection to live with.**

Next, the series moves to **operating systems**. The disk I/O, lock contention, context switching, and memory limits that surfaced throughout this series are all constraints imposed by *physical resources the operating system controls*. If the database series was built on the premise that "costs never disappear," the operating system is the layer that *hides those costs, defers them, and pretends they do not exist*. The operating system series begins at the structure of that illusion.