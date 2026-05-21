---
title: Database Part 3 - Transactions, A Treaty Between Consistency and Concurrency
description: Even perfect operations can break when intertwined concurrently. A transaction is a unit of control chosen by databases to prevent this chaos. ACID defines the rules of this control, and isolation levels determine the compromise between consistency and concurrency.
sidebar:
  order: 9
date: 2026-05-22
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: May 22, 2026</p>

> A flash sale on an e-commerce platform. A limited edition item with 100 available in stock sold out in a single second. In reality, however, a system failure occurred where 387 users successfully checked out. This happened because massive traffic surged simultaneously, causing all users to concurrently read the remaining stock as one (`stock=1`) and proceed with payment.
>
> The Google BigQuery outage on October 13, 2022, follows the same fundamental pattern. The code was identical to what ran every day, but the entire system broke down when traffic spiked briefly. The safety mechanism (locks) implemented to prevent data inconsistency produced the exact opposite effect. One request waited for another, which in turn waited for yet another, leading into a deadlock where no locks could be released.

*Reference: [E-Commerce Race Condition (2026)](https://medium.com/@chaturvediinitin/how-i-eliminated-inventory-race-conditions-in-a-production-e-commerce-system-2302ba81846b)*   <br>
*Reference: [Production Postmortem Collection (danluu)](https://github.com/danluu/post-mortems)*


<br>

Although the two systems failed in different ways, they point to the same core issue. The moment multiple users touch the same data concurrently, a system faces two outcomes: data inconsistency or system-wide blocking.

One is the breakdown of data integrity. 387 people pay for 100 items of stock, and the stock count drops into a negative number. This is a failure where the system can no longer preserve its internal rules. This is a failure of **Consistency**.

The other is a complete system stall. The data itself remains clean, but every request waits for another, and no progress is made. This is a failure where the system loses its ability to process activity at scale. This is a failure of **Concurrency**.

These two forces compete for the same resource. To guarantee stronger consistency, concurrency must be reduced; to increase throughput, strict correctness guarantees must be relaxed.


<br>

## Transactions Balancing Concurrency and Consistency

Let us zoom into a single scene to pinpoint the problem.

There is exactly 1 item left in stock. User A reads `stock = 1`. User B also reads `stock = 1`. Both determine that stock is available and proceed with their payments. Each action is valid in isolation. However, when both execute concurrently, the system sells a single unit of stock to two different users.

```
[ Remaining Stock = 1 ]

User A ──▶ Determines "In Stock" ──┐
                                   ├─▶ Concurrent Execution ─▶ System Consistency Fails
User B ──▶ Determines "In Stock" ──┘
```

This is the core issue. **Each request is valid in isolation, but when executed concurrently, the system becomes incorrect.** It is a structure where rational individual actions overlap and break the system as a whole. If left unchecked, this pattern repeats whenever traffic spikes.

The flaw is not in the logic of each request, but in the fact that multiple requests access the same data at the same time. When another operation slips between a read and a write, the data can no longer maintain a consistent state.

This is why the database steps in. It groups multiple operations into a single unit and defines a rule that prevents external interference. This unit is called a **Transaction**.

A transaction is a treaty that manages the balance between consistency and concurrency. Leaving all operations completely free leads to inconsistent data, while forcing every operation into a strict sequence reduces system throughput. A transaction acts as a unit of control that achieves **balance between these two values** by granting temporary exclusivity to each operation.


<br>

## ACID — The Four Rules of the Treaty

So what exactly is a transaction trying to prevent?

A database must maintain trust in its data even amidst a flood of concurrent operations.
If intermediate states are exposed, operations interfere with each other, or completed results vanish, the system can no longer provide a consistent view of the same data.

**ACID** represents the four safety rules databases have established to prevent such accidents.

Atomicity, Consistency, and Durability are relatively clear-cut. They ensure that no intermediate states are left behind, no data that violates rules is stored, and no finalized results are lost. They are the fixed regulations that prevent mishaps like money evaporating during a transfer or inventory turning negative.

But **Isolation** is different. This rule, which prevents interference from in-progress operations, leads to a reduction in the number of operations that can be processed concurrently the more strongly it is guaranteed. And it is here, where the negotiation between consistency and concurrency begins.


<br>

## Isolation Levels — The Trade-off Between Concurrency and Consistency

Isolation ultimately comes down to a single question: **How much can the same data be exposed to multiple concurrent operations?** Opening it too freely leads to reading invalid data, while restricting it too tightly slows down the entire system. Isolation levels are step-by-step compromises defined by databases—a progression where the cost of control gradually increases.

```
Concurrency Priority
▲
│  Read Uncommitted
│  └─ Uncommitted data allowed
│
│     Read Committed
│     └─ Only committed data visible
│
│                   Repeatable Read
│                   └─ Consistent snapshot maintained
│
│                                         Serializable
│                                         └─ Sequential execution enforced
│
└────────────────────────────────────────────────────────▶ Consistency Priority
```

- **Read Uncommitted** — Concurrency ≫ Consistency  
  The most relaxed level. It allows operations to read data that has not yet been committed. While throughput is high, decisions may rely on values that could later be rolled back. It maximizes concurrency at the cost of data reliability.

- **Read Committed** — Concurrency > Consistency  
  A transaction can **only read data that has been committed** by other transactions. This is the default in PostgreSQL and Oracle, and one of the most common production trade-offs. However, values may still change between reads within the same transaction.

Even here, a gap remains. A value can change between reads because **other operations may slip in between a read and a write.**

- **Repeatable Read** — Concurrency < Consistency  
  A transaction **keeps the same snapshot it first observed until it completes**. Even if other transactions modify the data, its view does not change mid-way. In return, the system pays higher costs in version management and conflict handling.

Still, one edge case remains: newly inserted rows can appear during a query after the transaction has started—this is known as a phantom read.

- **Serializable** — Concurrency ≪ Consistency  
  It forces all operations to behave as if they were executed in strict sequence. Consistency is maximized, but concurrency drops significantly. This level effectively prioritizes correctness over throughput.

Choosing an isolation level is not purely a technical decision. It is a business trade-off between two risks: inconsistent data or reduced system performance.  

In domains like finance and accounting, where small errors carry high impact, stronger isolation is justified. In contrast, systems like social feeds or recommendation engines can tolerate slight delays, making higher concurrency more valuable.

### MVCC — The Coexistence of Concurrency and Consistency

This progression raises an obvious question. if maintaining consistency requires blocking other transactions from accessing data, the simplest solution is to apply a lock and force other operations to wait. However, this quickly causes throughput to collapse.

Databases found a way to satisfy both requirements at the same time. The safety required by consistency (hiding in-progress modifications) is achieved through **previous versions** of data, while the responsiveness required by concurrency (avoiding wait time) is achieved through **new versions**. In short: **readers do not block writers, and writers do not block readers.**

This is the core idea behind **MVCC (Multi-Version Concurrency Control)** as used in systems like PostgreSQL and MySQL’s InnoDB engine. Instead of overwriting data in place, the database creates a new version. While a write operation produces a new version, read operations continue using the older version without waiting, enabling concurrent access without blocking.

Ultimately, by introducing the concept of **versions** to a single resource, the database avoids physical contention at the same point in time.


<br>

## Locks — The Mechanism Enforcing the Rules

Conflicts between consistency and concurrency inevitably arise when multiple transactions attempt to access the same resource at the same time. A **Lock** is the device databases use to manage these contentions.
In other words, if *ACID* and *Isolation Levels* are the treaty documents, locks are the hands that enforce that treaty on the ground.

However, databases diverge into two strategies on how they wield these hands.
Should they prevent overlap from the start, or only check at the last moment?

### Assuming High Contention — Pessimistic Locking

Pessimistic locking **treats contention as the default**. To prioritize consistency, it applies a lock the moment data is accessed, blocking other transactions **before they begin**. The waiting time for data allocation and the reduction in throughput are **all incurred as upfront overhead**. The latency cost of yielding concurrency is clearly felt each time.

Consider a first-come, first-served flash sale where 10,000 orders flood in for 100 items in stock. If consistency is compromised here, the system will **oversell its inventory**, so pessimistic locking queues all 10,000 orders. The first 100 secure the stock, and the rest are processed in sequence, being declined when stock is depleted. It firmly maintains consistency at the cost of constraining the entire system to the pace of the queue.

### Assuming Low Contention — Optimistic Locking

Optimistic locking **treats contention as the exception**. To secure concurrency first, it allows operations to proceed, then validates just before commit: "Is the value I first read still the same?" If unmodified, it passes; if changed in the interim, the operation fails and retries.

The cost model is **strictly pay-per-use**. Retry overhead is incurred only when interference materializes, so the cost trends toward zero the rarer contention becomes. Collaborative document editing, where multiple users seldom modify the exact same line simultaneously, is a canonical use case. It eliminates the latency of queuing everyone defensively against unlikely collisions.

### Summary

Pessimistic locking prioritizes consistency and proactively pays the concurrency cost.
Optimistic locking prioritizes concurrency and only pays the cost when contention manifests.

Ultimately, which strategy fits best hinges on the actual frequency of contention in production.

<br>


## Deadlocks — When Coordination Breaks Down

The system is designed to balance consistency and concurrency. But when coordination rules are enforced too rigidly, they can paradoxically lead to a standstill: transactions start waiting on each other indefinitely.

Consider transactions A and B. A locks the resource it needs and waits for the next to be available. B does the same. Each holds a resource and waits for another. This is normal under pessimistic locking. No rule is broken.

The problem arises when **each transaction holds the resource the other needs next**.
A waits for B to release, and B waits for A. Both are halted.
No invalid operation occurs, yet the system is **deadlocked**.


```
               ┌────────────────────┐
               │ Resource 1 (MUTEX) │
               └────────────────────┘
                 ▲                 │
    Held By      │                 │ Waited For By
  (No Preemption)│                 │
                 │                 ▼
           ┌─────┴──────┐     ┌────┴──────┐
           │Transaction │     │Transaction│
           │     A      │     │     B     │
           └─────┬──────┘     └────┬──────┘
  Waited For By  ▲                 │ Held By
                 │                 │ (No Preemption)
                 ▼                 ▼
               ┌────────────────────┐
               │ Resource 2 (MUTEX) │
               └────────────────────┘
An Entire System Locked in a Closed Loop ──► [Circular Wait] ──► Deadlock
```

A deadlock isn't a logic error. It's a structural failure where a coordination model designed for data safety ends up halting all progress.

To handle this, databases don't leave the system deadlocked. They continuously monitor who is waiting for whom. When a circular dependency is detected, one transaction is forcibly aborted to break the cycle. The deadlock detector in PostgreSQL exemplifies this.

Here, the system **aborts a valid transaction** to restore overall flow. Rather than freezing entirely, it sacrifices one operation to unblock the rest.

The mechanism built for consistency ultimately breaks its own rules for the sake of system-wide progress.

<br>

## The Fallacy of Composition: Why Everything Was Right, Yet the System Failed

The failures discussed so far are not separate problems.

Stock discrepancies, isolation anomalies, and deadlocks all follow the same structural pattern. An action that is valid at the level of a single transaction can lead to system-wide failure when executed concurrently.

In 1936, economist John Maynard Keynes described this cognitive trap as the **Fallacy of Composition**. He observed that many policy errors in macroeconomics follow the same pattern: **an action that is individually rational can become irrational when aggregated.**

Keynes's famous illustration of this is the **Paradox of Thrift**. During an economic recession, every household **rationally** increases their savings. At an individual level, this is a correct decision to prepare for the future. However, if everyone increases their savings simultaneously, consumption drops, corporate revenues decline, employment falls, and **ultimately, the very income available to save disappears.** This is the moment individual rationality transforms into systemic irrationality.

Keynes’s most well-known example is the **Paradox of Thrift**. During an economic recession, every household **rationally** increases their savings. At the individual level, this is a reasonable response to uncertainty. However, when everyone behaves the same way at the same time, consumption falls, corporate revenue declines, employment drops, and ultimately even **the income available for saving disappears**. This is the point where individual rationality turns into system-wide irrationality.


*Reference: [Keynes, "The General Theory of Employment, Interest and Money" (1936)](https://www.marxists.org/reference/subject/economics/keynes/general-theory/)*

### The Intervention of the Database

**The Fallacy of Composition is a structural trap that a database must continuously manage.**

A database is not concerned with the failure of a single transaction.  
It is concerned with system-level collapse caused by multiple transactions executing concurrently.

As a result, a database prioritizes system stability over the optimality of individual operations.

It enforces control through locks, limits exposure through isolation levels, and avoids contention entirely using MVCC.
When a deadlock occurs, the system may abort a valid transaction to restore overall progress.

Every control mechanism in a database exists to prevent this system-level failure.

**It prevents the point where a system collapses even though every individual process is correct.**

<br>

## The Bottom Line

**Even when each transaction is correct, the system can collapse when they are combined.** The trade-off between consistency and concurrency is a structural overhead that must be managed in any concurrent system. Every decision in transaction design is grounded in these two questions.

When an engineer understands this architecture, they stop asking "who wrote the bad code?" after a concurrency issue. Instead, the question becomes: **To what extent do we enforce this agreement, and where do we pay the cost of that guarantee?** Every decision in transaction design is grounded in these two questions.


Next up: The system expands beyond a single node. When a single database can no longer handle incoming traffic, the system begins to partition across nodes. Once data is distributed, the agreement between consistency and concurrency must be redefined in a **distributed environment**.