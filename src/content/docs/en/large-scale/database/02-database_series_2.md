---
title: Database Part 2 - The Two Sides of Index Structures
description: Indexes are not a free search mechanism. They are a trade where writes are sold for reads, and half of that transaction is billed invisibly.
sidebar:
  order: 8
date: 2026-05-20
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: May 20, 2026</p>

> 3:00 AM at a fintech team. The payment system shut down. The cause was a single feature shipped on Friday evening. A missing index forced a full table scan on a 2.4-million-row table for every payment. The outage lasted for 48 minutes, costing $47,000 in lost revenue. A single line of index configuration could have prevented this.
>
> Another team, another system. This time, it was the exact opposite. 955 indexes across 119 collections—an average of 14 indexes per collection. Reads were fast. However, at a certain point, the write queue began to back up. Replication lag accumulated. Disk latency spiked up to 999ms. For every single row inserted, 14 index trees had to be updated concurrently.

The database failed twice in the exact same place: once because there was no index, and once because there were too many indexes.

Part 1 closed by pointing to **indexes** as the physical method for cutting the number of disk accesses themselves.

Indexes are not free. Instead of making reads fast for free, they impose a tax on writes. Every indexing decision in a database ultimately boils down to a single line: **Indexes trade writes for reads.**


*Reference: [Production Incident Story (2026)](https://medium.com/@code_pulse_devrim/production-incidents-terrified-me-until-i-built-this-3-am-checklist-0c7d44a4e75b)*  <br>
*Reference: [MongoDB Community: Performance Impact of 955 Indexes](https://www.mongodb.com/community/forums/t/performance-impact-of-955-indexes-in-one-database/300227)*


<br>

## The Cost of a Full Table Scan

Searching without an index is **a process of checking every wrong possibility one by one**. To find a single correct row among 10 million records, the system must examine almost all 9.99 million remaining rows. The real cost of a full table scan is not finding the answer, but examining everything that is not it.

An index changes this structure. It allows the system to avoid most rows entirely, effectively providing **the right not to read**. Like the index at the back of a book, it removes large parts of the data from consideration before the search even begins.

But there is a hidden cost here. Every time data changes, the index must also be updated. In exchange for avoiding full table scans, the system now pays an additional cost called **index updates** on every insert or modification.

Reads become cheaper, but every write carries more cost. Now we can look inside the system to see how this works.

<br>

## The Environment as a Variable

The trade-off an index must resolve is straightforward: **fast retrieval versus efficient insertion**. The history of data structures is largely a record of how different models balance these two goals.

But the answer is not determined by the data structure itself. It is determined by **the cost structure of the environment in which it runs**.

Memory and disk define cost in completely different ways.

- In memory, CPU operations are expensive.
- On disk, I/O operations are expensive.

In memory, what matters is how few key comparisons are performed.
On disk, what matters is how many pages are read.

The same data structure behaves differently depending on how cost is measured.

<br>

## Participants in the Memory Environment

The memory environment sets a clear constraint. In memory, data can be accessed without the cost of moving large pages, unlike disk-based systems. Once this transfer cost disappears, only one bottleneck remains: **the cost of computation itself**.

In this environment, the question is how **that cost is divided between insertion and lookup**.

Keeping a tree strictly balanced during insertions guarantees faster lookups later, at the cost of significant restructuring overhead on every write.
Conversely, relaxing that constraint improves insertion speed, but shifts the cost toward more comparisons during lookup.

Different data structures represent different ways of resolving this trade-off.

### The Lineage of Participants

Let’s start by looking at the table below.

| Data Structure | Gains | Losses | Storage | Operating Environment |
| :--- | :--- | :--- | :--- | :--- |
| Binary Search Tree | Fast retrieval | No balance guarantee | Memory | (None — Unsuitable for indexing) |
| AVL Tree | Strict balance | Heavy write overhead | Memory | (Rarely used in production) |
| Red-Black Tree | Recovered write efficiency | Perfect balance | Memory | Linux Kernel, Java TreeMap, std::map |
| B+Tree | Minimal disk access | In-memory compute efficiency | Disk | DB Index, File Systems |

**Binary Search Tree — Fast Retrieval, Unpredictable Balance**

The earliest answer was the Binary Search Tree. Retrieval was fast, provided the tree remained balanced. The flaw was that **balance** depended entirely on luck.

If data arrived in sorted order, the tree skewed to one side and gradually stretched into a long chain. 
Read performance was held hostage by an outside factor it could not control—**the order of data entry**. This unpredictability disqualified the Binary Search Tree as an index candidate.

**AVL Tree — Strict Balance, Heavy Writes**

The AVL Tree (1962) addressed this limitation directly by maintaining strict balance regardless of incoming data, securing **consistent read speed**.

But the cost was **slower writes**. Maintaining balance on every insertion was expensive.

**Red-Black Tree — Light Writes, Loose Balance**

The Red-Black Tree (1972) treated AVL's balance as overpriced. It opted for a workaround, guaranteeing only **approximate balance**.

```
[ Red - Black ]

         Storing 100M Keys

              [Root]            Tree Height: ~30
              /    \
           [N]      [N]         Disk Accesses: 30
          / \        / \        Each access fetches a full page
        [N] [N]    [N] [N]

      ... Down to Depth 30 ...
```

This pragmatic compromise came to dominate the general-purpose market for managing sorted data in memory. The Linux kernel scheduler, Java’s `TreeMap`, and C++’s `std::map` all leverage this solution. 

But this champion collapsed in front of database indexes, where the rules of cost had changed.

<br>

## The Disk Environment's New Participant

The unit of cost in disk is entirely different from memory. Because disks read data only in large chunks called **pages**, looking at even a single node costs an entire page(16KB). 

### The Downfall of the Memory Champion

The Red-Black Tree was optimal in memory, but its value drops sharply when evaluated in terms of disk cost.

```
[ Structure Comparison for 100M Keys ]

Red-Black Tree       Tree Height: ~30 stories → Disk Accesses: 30
B+Tree               Tree Height:   4 stories → Disk Accesses:  4
```

To store 100 million keys, a Red-Black Tree requires a height of roughly 30. 
In memory, 30 comparisons take a split second. 
On disk, it becomes **30 separate I/O operations**.
Fetching a single record requires opening a costly warehouse 30 times. 

### The Design Principle of the B+Tree

The B+Tree was designed for this cost structure from the start. The idea is simple: if you must read a full page anyway, pack it with as much useful data as possible.

Accordingly, the B+Tree compresses hundreds of keys into a single node, matching the node size precisely to the disk's page unit. This allows **a single disk access to bring hundreds of keys into memory at once** for comparison.

```
[ B+Tree Structure ]

        [Root: 100 keys]            
        /    |    |    \
        [...100 keys...]             ← One Node = One Page (Hundreds of branches)
      / | | \   ... 
    [Leaf nodes: Actual Data]         ← Leaf nodes linked sequentially
    → → → → → → → → → → → → → → 

    (Range queries traverse sequentially along the leaves)
```

As the tree grows wider, its height drops dramatically. Even with 100 million records, it remains only 4 levels tall, **reducing disk accesses from 30 to 4**.

### The Market's Decision

The progression from Binary Search Trees to Red-Black Trees was an evolution that happened within the memory-based design space. In contrast, the B+Tree is not part of that lineage; it is a structure designed specifically for **disk-based cost constraints**.

No data structure is universally better than another. The right choice depends entirely on **how cost is measured**.


<br>

## The Architecture of an Index and Its Hidden Cost

If the B+Tree is the backbone of an index, then what you build on top of it is determined by priority. Every index turns a visible performance gain into a hidden physical cost somewhere else in the system.

Architecture design is not about free performance. Every visible gain shifts cost somewhere else in the system.

### Hash Index — An Equal Exchange

Sometimes a point lookup is required. This means fetching a single row instantly using a specific value like a `user_id` or an order number. Hash indexes are built for this exact purpose. They convert the key into a hash to calculate the exact location, making equality lookups incredibly fast.

But this structure completely throws away data ordering. Since values are distributed randomly, range scans and sorting are out of the question.

### Composite Index — Priority Allocation

In reality, queries often come with multiple conditions clustered together. Multiple columns are frequently applied as filters simultaneously—whether it is fetching "the recent orders of this user," where both `user_id` and `created_at` appear together, or "sorting by price within this category."

```
[ Composite Index (user_id, created_at) ]

Index Sort Order:

    user_id  | created_at
    ─────────┼───────────
    100      | 2024-01-01
    100      | 2024-02-15
    100      | 2024-03-20
    200      | 2024-01-10
    200      | 2024-02-05
    300      | 2024-01-25

  ✓ WHERE user_id = 100                        → Fast (reads from the front)
  ✓ WHERE user_id = 100 AND created_at > ...   → Fast (utilizes both)
  ✗ WHERE created_at = '2024-01-01'            → Cannot use index (left column missing)
```

A composite index does not provide equal efficiency across all columns. Because the index is ordered strictly from the leading column onward, queries that include the first column are processed quickly, but searching by the trailing columns alone makes the index completely unusable.

### Covering Index — The Price of Bloat Accepted

As mentioned in DB Part 1, reading data from disk incurs a prohibitively high cost. Environments with severe read bottlenecks require an index architecture designed specifically to address this bottleneck.

A covering index drastically improves read performance by embedding all necessary data right inside the index pages, minimizing the actual disk I/O cost.

However, as more columns are appended, the physical size of the index expands. Consequently, whenever data is inserted or modified in the table, a much heavier penalty must be absorbed during write operations.

### Summary

In architectural design, there is no such thing as a "free win." The selection criteria below are also the result of weighing both sides of the transaction.

| Index Type | Visible Benefit | Invisible Cost | Optimal Scenario |
|---|---|---|---|
| Hash Index | Ultra-fast point lookups `O(1)` | Complete neutralization of range queries and sorting | When point lookups based on unique key-value pairs are primary |
| Composite Index | Multi-filter optimization for complex conditions | Steep drop in utility if the leading column is missing | When clear business query patterns consistently query grouped columns |
| Covering Index | Eliminates disk access to data pages | Index bloat and increased overhead across all writes | When read frequency is dominant and the write slowdown can be absorbed |


<br>

## What Is Seen and What Is Not Seen

In his 1850 essay "That Which Is Seen, and That Which Is Not Seen," French economist Frédéric Bastiat pointed out a core error in economic judgment. People tend to react to **the visible, immediate consequences** of an action, but fail to calculate the **invisible, cascading consequences** that occur simultaneously.

His 'Parable of the Broken Window' is a prime example. When a window breaks, the glazier gets business (the visible result), but the money spent on the window vanishes from transactions the owner would have otherwise made on books or clothes (the invisible result). Ultimately, for society as a whole, it represents a net loss of resources rather than wealth creation. The visible gain merely masks the invisible loss.

*Reference: [Bastiat, "That Which Is Seen, and That Which Is Not Seen" (1850)](https://www.econlib.org/library/Bastiat/basEss.html)*

The paradox of database indexes mirrors this exact structure.

### Visible Gains and Hidden Cost

When an index is added, the improvement in reads is **visible and immediate**. In contrast, the latency introduced to write queries is under a few milliseconds per operation, making it **invisible and delayed**.

This hidden cost builds up silently with every write operation. In high-traffic systems, the accumulated disk work forms write queues and leads to replication lag, eventually degrading overall system performance.

**No index** (full scan) and **too many indexes** (accumulated write cost) lead to the same invisible loss, just in different forms.

### Cognitive Bias of Index Overuse

This asymmetry creates a bias in how engineers respond. Every slow query tends to trigger another index, because the improvement is immediate while the cost is not visible.

Hundreds of indexes in a database are not a design failure. They are the result of many small decisions that prioritized visible gains and ignored hidden costs. The same bias Bastiat described in economics shows up again in modern database systems.

### Making the Hidden Cost Visible

Indexes are not free. They always move cost somewhere else in the system.

Index design is not just a performance problem—it is a question of **how cost is distributed**. When a new index is added, two things need to be evaluated.

First, **who benefits from it**. There is no reason to trade write performance for a statistical query that runs only a few times a year, while INSERT operations happen dozens of times per second. Every index should be justified by queries that rely on it frequently.

Second, **whether the cost makes sense over time**. The overhead of maintaining an index (slower writes) must be justified by the benefit it provides (faster reads). Keeping an index for rarely executed queries is usually not a reasonable choice.

The core of index management is not growth, but **cleanup**. Unused indexes become constant overhead that degrades write performance. In many cases, removing an index improves performance more than adding a new one ever could.


<br>

## The Bottom Line

Indexes are the most powerful tool databases use to avoid full table scans. This tool enables queries to skip 99% of data, directly realizing the premise established in DB Part 1: **read less from disk**. However, this capability is not free. Indexes trade writes for reads, and part of that cost is paid invisibly.

Engineers who understand this structure weigh the decision to add an index just as carefully as the decision to remove one.

**Which query does this index prioritize, and who pays the price for that priority?**

Next up: when multiple users access the same data at the same time, the database has to decide what to allow and what to block. When performance and consistency collide, a set of rules emerges—this is where **transactions** come in.