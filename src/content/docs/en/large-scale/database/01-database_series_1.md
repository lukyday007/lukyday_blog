---
title: Database Part 1 - How Memory and Disk Shape the Cost of Persistence
description: "Every database optimization comes down to one question: 'Where is the data?' Breaking down the threshold of memory vs. disk, the buffer pool, and the opportunity cost of every cached page."
sidebar:
  order: 7
date: 2026-05-19
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: May 19, 2026</p>

> The Redis engineering team highlighted a clear pattern in their report. "Performance does not degrade gradually." In fact, a development team handling large-scale vector data experienced a sharp drop in query speed the moment the data size exceeded the RAM capacity.
>
> The same phenomenon occurred during Discord's MongoDB operation in 2015. The moment the total amount of data and indexes exceeded the RAM size, the message loading speed of the stable system instantly faced a limit.

*Reference: [Vector DB / Redis](https://redis.io/blog/common-challenges-working-with-vector-databases/)* <br>
*Reference: [Discord](https://discord.com/blog/how-discord-stores-billions-of-messages)*

<br>
<br>


Although the data types and timelines differ, the core challenge for both teams remains identical.
Data leaving the memory forces the system to fetch resources from the disk. This transition increases latency costs by several orders of magnitude.
Database performance management ultimately comes down to one question:

**Where the data is located determines the productivity of the system.**

<br>

## The Cost of Persistence

The top priority of a database is **Persistence**. Even if the power turns off or unexpected risks occur, **data must be safely preserved**.

Paradoxically, this promise ties the database to the disk. This medium carries the highest acquisition cost in the entire architecture. The differences in access speed and cost for each storage medium are non-linear.

```
L1 Cache       ~1 ns
RAM            ~100 ns              (100x slower than L1)
SSD            ~100,000 ns          (1,000x slower than RAM)
HDD            ~10,000,000 ns       (100,000x slower than RAM)
```

Accessing data from RAM relies on internal memory resources. Fetching it from an SSD (Disk) requires external disk operations. These costs operate on entirely different scales. When data leaves the memory, the transaction volume per second becomes severely limited.

This situation creates the fundamental trade-off of the database: balancing persistence costs against in-memory operational efficiency.

Therefore, when system latency incurs costs, engineers should not check for missing indexes first. The priority is to determine **whether the data still fits within the effective memory working set**. Alternatively, it might depend on **expensive disk fetches via I/O**. This judgment determines the debugging direction.


<br>

## The Buffer Pool as the Database's Workplace

To reduce disk access, data must ultimately reside in memory. The **Buffer Pool** is the dedicated space the database allocates from RAM for this purpose.

Calling the buffer pool a temporary cache misses its essence. In a database, **memory** does not store surplus assets like a warehouse. It acts as **the main working area where all data processing occurs**.

### Division of Labor Between Disk and Memory

The disk and memory operate under a strict division of labor. The concepts of *reading and writing* defined by the two media differ fundamentally.

- **Disk Transactions (I/O)** This represents simple transfer and storage without any modification to asset contents. The disk cannot perform high-value operations on its own.
- **Memory Transactions (Buffer Pool)** This involves actual processing and settlement where the CPU directly accesses and changes the asset value.

Due to hardware constraints, all business operations begin only after pages move from the disk into the buffer pool.

- **During Asset Retrieval (Read)** The system copies the entire page from the disk to the buffer pool. The system then searches inside this space to select data. The disk does not classify contents on its own.
- **During Asset Modification (Update)** The system does not directly alter disk figures. It opens the page in the buffer pool to modify the contents first. Altered pages stay in the buffer pool as Dirty Pages. The system later transfers them to the disk via overwriting.

Ultimately, the disk only handles **physical retrieval**. The **actual value-generating work** occurs solely in memory.

### Economic Limits of Working Set and Workplace Area

The success of the system depends on **whether the working set fully fits within the available memory space**. The working set represents the scale of actively used data.

**Memory is a high-cost, scarce resource**. Memory efficiency deteriorates sharply the moment the limited facility fails to handle the working set.

- **Replacement and reload costs**: Bringing in new data requires evicting existing pages. This re-acquisition cost via Disk I/O erodes productivity. Choosing to maintain a specific resource means paying the re-acquisition opportunity cost of the displaced resource.
- **Reaching a Threshold Rather Than Gradual Degradation**: The system experiences a sharp drop in throughput if it repeatedly evicts and immediately re-fetches data due to insufficient capacity. It does not experience a gradual decline.

The failures of Discord and the vector DB team were resource **exhaustion phenomena**. These occurred as **the transaction threshold manageable by the available memory capacity was exceeded**. The performance limit is an inevitable result when the limited facility cannot withstand the workload.


<br>

## Why the OS Isn't Enough

The operating system (OS) also utilizes a **Page Cache** when reading files. It shares the same purpose as the database's buffer pool: keeping disk data blocks in RAM. Why then does the database claim its own dedicated workplace, causing apparent duplication?

Because delegating full control over memory to a general-purpose manager like the OS does not align with the **unique characteristics** and **cost structures** of database operations.

### Priority Determination Authority

The OS manages all processes equally. The OS cannot identify the individual value of assets. It commits a resource allocation error by evicting core assets like index pages out of memory. This happens based purely on retrospective statistics showing they were not recently accessed.

```
[ OS ]                                             

    "Equitably manages all processes"                              
                                                                               
    Chrome         VSCode         DBMS           Game          Python             
        │             │             │              │              │               
        └─────────────┴─────────────┼──────────────┴──────────────┘              
                                    │                                           
                          Manages memory uniformly                               
                                                                                
               [ Page A ] [ Page B ] [ Page C ] [ Page D ]                 
                                    ↑                                                     
                            "Blind to priority"
```

On the other hand, the database **accurately identifies which pages carry the highest operational value**. It distinguishes which data is a core asset supporting thousands of queries. It persistently retains highly utilized pages within the buffer pool.

```
[DBMS]
                                                                        
    "Identifies page priority natively"                  
                                                                            
    SELECT * FROM orders WHERE user_id = 10;                                
                                                                            
    Query Plan                                                               
        │                                                                   
        └──→ [ Index Page ] ──→ [ Leaf Page ] ──→ [ Data Page ]             
                   ↑                  ↑                 ↑                 
              Repeated Access     Next Path         Actual Data          
                  (Hot)           Predicted                                                       
                                                                           
    Cache Priority   

    [ Index Page ]  >>>  [ Leaf Page ]  >>>  [ Cold Data Page ]             
              Retains pages predicted to be read again soon
```

### Investment Based on Future Plans

An OS caching strategy relies entirely on historical records, operating under the assumption that a recently read page is highly likely to be read again.

```
[OS : LRU(Least Recently Used)] 

Page Access

    A ─→ B ─→ C ─→ D ─→ B ─→ C ─→ E
                   │
                   ▼
             Recently Used

    HOT ──→ [ C ] [ B ] [ D ] [ E ] ──→ COLD
                                          │
                                          ▼
                                   Remove [ A ]
```

Conversely, the database **ascertains the required data in advance** through the query execution plan. Knowing the demand that will follow when acquiring a specific resource, it executes a preload from the disk beforehand. This is far more efficient than the retrospective estimation of the OS.

```
[DBMS : Predict]

    SELECT * FROM orders WHERE user_id = 10;
                         │
                         ▼

                    Query Plan

    [Index Page] ──→ [Leaf Page] ──→ [Data Page]
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                Next Page Prediction

    SSD ──→ Buffer Pool Preload
```

### Exclusive Efficiency Bypassing Double Buffering

If a database relies on the OS cache, the same data is loaded twice: once in the OS domain and once in the DB domain, leading to **double buffering**. This represents an inefficient, redundant use of a constrained resource (RAM).

```
[ Double Buffering ] 

┌───────────┐    ┌───────────────┐    ┌────────────────┐    ┌───────┐
| SSD / HDD | ─→ | OS Page Cache | ─→ | DB Buffer Pool | ─→ | Query |
└───────────┘    └───────────────┘    └────────────────┘    └───────┘ 
                      Copy #1              Copy #2
```

High-performance databases bypass the OS cache and communicate directly with the hardware using a direct-access mechanism known as the `O_DIRECT` flag. This eliminates redundant allocation and allows the database to distribute the reclaimed resources entirely according to its own internal logic.

```
[ O_DIRECT ]

┌───────────┐                    ┌────────────────┐     ┌───────┐
| SSD / HDD | ─────────────────→ | DB Buffer Pool | ──→ | Query |
└───────────┘                    └────────────────┘     └───────┘
               OS Cache Bypass
```

Ultimately, while the OS is an excellent general-purpose manager, it does not comprehend the specific situations occurring inside the database. **Allocating a workspace exclusively for the database** is a rational choice to achieve the most efficient decision.


<br>

## Opportunity Cost in Every Cached Page

The capacity of a buffer pool is finite. The decision to bring a new page into memory always entails a decision to evict an existing one.

Economist James Buchanan defined opportunity cost not as the price of the chosen alternative, but as **the value of the most preferred rejected alternative**. The buffer pool operates under this exact rule. The cost of maintaining page A in memory is not its physical footprint of 16KB. **The price of holding A in memory is the performance loss incurred when B, which was evicted because of A, must be read from disk again.**

*Reference: [Library of Economics and Liberty: Opportunity Cost](https://www.econlib.org/library/Enc/OpportunityCost.html)*

From this perspective, Least Recently Used (LRU) is a core decision-making model for asset management. It functions as a clever resource eviction model. It selects the **target with the least loss** when abandoned, based on the assumption that the asset with no recent transactions will also possess the lowest future value.

The same applies to LFU (Least Frequently Used), which merely estimates future value based on access frequency. The InnoDB modified LRU structure is no different; it is a sophisticated valuation model designed to prevent a single massive scan from polluting valuable assets (the working set).

Although the names vary, they all answer the same question. **To which data will this limited working set capacity be allocated?**


<br>

## Three Strategies for Memory Limits

When query performance degrades, the first metric to verify is the **Buffer Pool Hit Ratio**. A drop in this figure signals that memory cannot handle the working set, **causing frequent disk accesses**. At this point, engineers must readjust capital allocation.

### Working Set Reduction Through Data Footprint Removal

This strategy cleans up data with **low value** for occupying memory. By **deleting unused indexes or archiving old data**, situations where core data is displaced from memory can be prevented. This is a fundamental method to physically eliminate the opportunity cost arising from the current choice.

### Hardware Expansion for Scale Up

This is the most explicit choice when there is no luxury to alter the design. **By increasing RAM capacity to expand the workplace itself, the contention structure surrounding resources is resolved.** This is a capital-efficient strategy chosen when hardware costs are cheaper than optimization costs through development.

### Migration to Disk Centric Architecture

If the data scale is too massive to be handled by expanding memory alone, **retaining data in memory must be abandoned**. In this case, migration occurs to a system like an LSM tree. It calculates disk reads as a natural cost rather than a failure. Utilizing cheap disks efficiently is more advantageous in the long run than struggling to defend expensive memory territory.


<br>

## The Bottom Line

The database carries the disk, which is the slowest medium, as the price for guaranteeing persistence. The only way to overcome this inherent limitation is **minimizing disk reads**, and **the buffer pool is the actual workplace where that strategy is executed**. Every page occupation in the workplace is a decision regarding opportunity cost.

Therefore, engineers have two options. One is buying RAM with money to purchase time, and the other is creating time by reducing disk access through structural optimization.

The core lies in accurately recognizing the method of paying the cost. An engineer who understands the structure does not panic in the face of system latency and asks that single question.

**Is the current working set accommodated in the workplace? If not, what opportunity cost will be accepted?**

Next up: We will explore how to physically reduce the number of disk accesses when the working set cannot fit within the working area. The technique to skip 99% of a table during every query: **Indexes**.

