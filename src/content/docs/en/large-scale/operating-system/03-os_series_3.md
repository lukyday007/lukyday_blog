---
title: "Operating Systems Part 3 — Virtual Memory and the Cost of Illusion"
description: "Operating systems did not solve memory scarcity. They delayed the moment when scarcity becomes visible. Virtual Memory is not a memory technique — it is a strategy for hiding constraints."
sidebar:
  order: 15
date: 2026-06-22
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: June 22, 2026</p>

> In 2018, AWS released Firecracker, the engine behind its serverless computing platform. To run thousands of programs simultaneously on a single physical server, AWS chose to allocate more memory than the server actually had. The assumption was simple: not all of those thousands of programs would be active at the same time. And most of the time, that assumption held.
>
> The same principle played out on Wall Street in 2008 — with the opposite result. Lehman Brothers was operating with 31 times more assets than it actually held in reserve. The system worked as long as no one demanded their money back all at once. When that assumption collapsed, Lehman filed the largest bankruptcy in U.S. history.

*Reference: [AWS: Firecracker – Lightweight Virtualization for Serverless Computing (2018)](https://aws.amazon.com/blogs/aws/firecracker-lightweight-virtualization-for-serverless-computing/)* <br>
*Reference: [Firecracker Internals: "over-commit resources" (2021)](https://www.talhoffman.com/2021/07/18/firecracker-internals/)* <br>
*Reference: [Economics Observatory: Why did Lehman Brothers fail? (2023)](https://www.economicsobservatory.com/why-did-lehman-brothers-fail)*

<br>
<br>

One succeeded. The other collapsed. But the strategy was the same: **promise more than you actually have, and hope that everyone does not come to collect at once.**

Hotels and airlines operate on this exact principle. A certain percentage of reservations will be cancelled or result in no-shows — that much is statistically reliable. So they accept more bookings than they have rooms or seats.

Operating systems make the same bet. **Physical memory is finite, but the OS behaves as though there is more than enough to go around.** Most of the time, this promise holds. The trouble begins when everyone tries to use it at once.

Following the coordination cost explored in Part 1 and the search cost examined in Part 2, this installment focuses on **the cost of illusion** — the price an operating system pays for making unavailable resources appear available.


<br>

## Why RAM Is Never Enough

Overbooking is not simply a gamble. Hotels and airlines leverage the statistical reality that a portion of reservations will go unused, accepting more bookings than they can physically serve. What matters is not the size of the resource itself, but **the assumption that actual usage will stay well below the promised maximum.**

Operating systems make exactly the same choice. Due to the expensive and limited nature of RAM, processes routinely request more memory than they actually use — yet rarely consume all of it at the same time. So the OS **promises more memory than it physically has.** Just as a hotel overbooks its rooms, the operating system overcommits its memory.

The goal of this structure is not to increase the physical capacity. **It is to ensure that the shortage is never exposed.**


<br>

## Virtual Memory — The Biggest Illusion an Operating System Creates

For an overbooked hotel to survive, one condition must hold: when a guest walks through the door and asks for their room, the shortage must remain invisible. If the hotel turns guests away or puts them on hold because rooms ran out, the model fails.

Operating systems face the same problem. They cannot reject a new program every time RAM is tight. The mechanism that resolves this constraint is **Virtual Memory.**

Accept every request upfront, and give each program the **illusion** of a vast, private memory space. Do not hand over physical memory in advance. Instead, map real RAM only at the moment the program reads or writes data.

```
[ Virtual Memory ]

Process A     "My 4GB"
Process B     "My 4GB"
Process C     "My 4GB"
           ↓
    ┌────────────┐
    │  Real RAM  │
    │    8GB     │
    └────────────┘

→ Every process believes it has 4GB. In reality, they share the same RAM.
```

Under this structure, every program operates as though it owns its memory exclusively. It never needs to know how many other programs exist, or how much physical RAM is actually installed.

Behind the scenes, the OS manages physical RAM, mapping virtual addresses to actual memory when needed—entirely hidden from the program. The illusion holds because **physical resources are allocated only at the exact moment they are required.**


<br>

## How the Illusion Is Maintained

Here is where it gets interesting. If the OS has promised far more memory than physically exists, how does it keep the system running without breaking the illusion?

The principle is simple. **Make the promise now. Defer the fulfillment.**

Just as a hotel does not prepare a room the moment a reservation is made, the OS does not allocate physical RAM the moment a program requests memory. It records the promise first. The actual resource is provided only when the program genuinely needs it.

The OS maintains this illusion through two mechanisms, including:

* **Lazy Allocation:** Defer the delivery of resources until the moment of actual use.
* **Page Fault:** The moment when the deferred promise must finally be honored.

The illusion that Virtual Memory creates holds only when these two mechanisms work in tandem.

### Lazy Allocation — Deferring the Cost

A confirmed hotel reservation does not mean a room is sitting empty, waiting. Until the guest arrives at the front desk and checks in, that room may be vacant or assigned to someone else.

The OS handles memory the same way. If a program requests 100MB but only touches 10MB, the OS allocates physical RAM for those 10MB alone. The remaining 90MB exists only as a promise — **no actual resource has been delivered yet.**

```
[ Lazy Allocation ]

Memory Request           First Access           Physical Memory Allocation
┌────────────┐          ┌────────────┐          ┌────────────┐
│  Program   │          │  Program   │          │    RAM     │
│  Request   │ ───────▶ │  Accesses  │ ───────▶ │   Page A   │
│  100 MB    │          │  Page A    │          │  Allocated │
└────────────┘          └────────────┘          └────────────┘
       │                       │
       ▼                       ▼
Virtual Reservation       Page Fault
 (Cost Deferred)          (Cost Paid)
```

This is **Lazy Allocation.** Physical memory is not assigned when requested. It is assigned **when used.**

### Page Fault — The Deferred Cost Comes Due

The reservation was accepted, but no room has been assigned yet. The moment a guest arrives at the lobby and asks to check in, the hotel scrambles to find an available room and hand over the key.

The OS operates the same way. It does not hand over physical RAM upfront. Then, when the program accesses a virtual address, the **CPU discovers that no physical memory is mapped to it yet and signals the OS for help.** This is a **Page Fault.**

A Page Fault is not a system error. It is **the moment when a virtual promise must be backed by a real, physical resource.** As long as these cost events occur at a manageable frequency, the Virtual Memory system operates without issue.


<br>

## Copying Without Copying

The OS's illusion strategy does not stop at making absent memory appear present. There is a further layer: **making it look like something was copied, when it never was.**

When a running process needs to be duplicated, the honest approach is to copy its entire memory space. But copying is expensive in both time and resources. If the duplicate barely modifies any data — or immediately replaces itself with a different program — that honest effort becomes a massive waste.

The OS avoids this inefficiency by deferring the cost once again.

### Copy-on-Write — Sharing Until Modification

When a copy is requested, the OS **does not actually copy anything.** Instead, it points both the parent and child process to the same physical memory. On the surface, the duplication appears complete. Underneath, a single resource is shared — and the real cost is postponed.

```
[ Copy-on-Write — Immediately After fork() ]

 Parent Process                Child Process
        │                            │
        ▼                            ▼
┌────────────────┐           ┌────────────────┐
│ Virtual Page A │           │ Virtual Page A │
└───────┬────────┘           └───────┬────────┘
        └─────────────┬──────────────┘
                      ▼
              ┌────────────────┐
              │ Physical Page A│
              │      DATA      │
              └────────────────┘

    One Physical Page Shared by Both Processes
```

The deferred cost surfaces only when one of the two processes **modifies** the data. At that moment — and only at that moment — the OS copies the affected page and separates them. This is **Copy-on-Write (CoW).**

```
[ Copy-on-Write — Child Modifies Page A ]

  Parent Process                Child Process
        │                             │
        ▼                             ▼
┌────────────────┐            ┌────────────────┐
│ Virtual Page A │            │ Virtual Page A │
└───────┬────────┘            └───────┬────────┘
        ▼                             ▼
┌────────────────┐           ┌──────────────────┐
│ Physical Page A│           │ Physical Page A' │
│      DATA      │           │    NEW DATA      │
└────────────────┘           └──────────────────┘

 Original Remains             New Page Allocated
```

Redis relies on this exact mechanism when generating RDB snapshots. Rather than copying the entire dataset upfront, it calls `fork()` and lets the child process share memory with the parent. **Only the pages modified by the main process are copied in real time.** This is why a multi-gigabyte snapshot does not cause an instantaneous resource spike.

The strategy frees the system from the burden of large-scale duplication. What was once an unconditional upfront cost becomes **a cost paid only when data actually changes.**


<br>

## When Everyone Demands the Truth at Once

Just like airline overbooking, the logic is straightforward: it is rare for every passenger to show up at the same time. Overbooking reduces the waste of empty seats, and on most flights, the strategy succeeds. The problem is the day when every last passenger appears at the gate.

Virtual Memory operates on the same premise. The OS assumes that not all programs will use their allocated memory simultaneously, and overcommits — promising far more space than physical RAM can cover. **When every program demands its share at once, the illusion that Virtual Memory has sustained begins to crack.**

### Paging and Swapping — The Price of Maintaining the Illusion

When every overbooked passenger shows up, the airline must reroute some to other flights and pay compensation. The efficiency-driven decision collides with physical limits, and unplanned costs follow.

When all programs consume memory at the same time and physical RAM runs out, the OS faces the same situation. It evicts less-recently-used memory regions to a **Swap area on disk**, and loads the currently needed data into the freed space. This is **Paging.**

The cost of maintaining the illusion is charged here. **Disk is orders of magnitude slower than RAM.**

```
[ Memory Hierarchy — Access Speed ]

CPU Cache    ██  (~1ns)
RAM          ████████  (~100ns)
SSD          ████████████████████████████  (~100μs)
HDD          ██████████████████████████████████████████  (~10ms)

→ The moment data is pushed from RAM to disk, access speed drops by a factor of thousands.
```

The program still believes it is accessing fast memory. Behind the scenes, the OS is servicing requests against storage that is thousands of times slower — spending time just to keep the illusion alive. This is why overall system performance begins to degrade.

### Thrashing — When the Cost of Illusion Exceeds the Cost of Real Work

Past the tipping point, the airline is no longer flying planes. It is processing complaints, negotiating compensation, and rerouting passengers. The strategy meant to improve efficiency has paralyzed operations entirely.

In operating systems, this state is called **Thrashing.** The overhead of copying and swapping data between RAM and disk grows so large that **the system can barely execute any actual computation.**

Thrashing is not simply a state of insufficient memory. The CPU and disk are running at full capacity — doing something. But **nothing of value is being produced.** The cost of sustaining the illusion has entirely overtaken the cost of doing real work.


<br>

## Constraints Do Not Disappear

The important takeaway is not that the OS solved the RAM shortage. The physical constraint of limited RAM remains, buried deep in the system. What the OS achieved was not the removal of the constraint, but the postponement of the moment when it brings the system to a halt.

This is the core insight of Eliyahu Goldratt's **Theory of Constraints.** The total throughput of any system is determined by its most scarce resource — the constraint. Just as a factory's output is bound by its slowest process, an operating system's throughput is always bound by the finite capacity of RAM.

Virtual Memory did not eliminate this constraint. It **strategically delayed the moment when the constraint becomes visible.**

* **Lazy Allocation:** Defers the delivery of physical resources, postponing the first exposure of the constraint.
* **Page Fault:** The moment the deferred constraint surfaces for the first time. the OS intervenes to fulfill the promise.
* **Swapping:** The constraint begins to exceed manageable limits. The OS must now recruit slower disk storage to maintain the illusion.
* **Thrashing:** The constraint dominates the entire system. More resources are spent hiding and managing the constraint than performing actual work.

Following the coordination cost of Part 1 and the search cost of Part 2, the essence of Virtual Memory is **the cost of illusion.** Costs cannot be eliminated entirely — they can only change form. The illusion created by overcommit delivers peak efficiency as long as the constraint stays hidden. But once the tipping point is crossed and every program demands its promised share at once, all deferred costs come due at the same time.

**Constraints do not disappear. They can only be revealed later.**


<br>

## The Bottom Line

Operating systems do not create more memory. They make insufficient memory appear sufficient. Most of the time, this strategy works remarkably well.

Programs behave as though they have plenty of memory. The system shares scarce resources with efficiency. But this is not a solved problem. **It is closer to a strategy for making the reality of memory scarcity arrive as late as possible.**

Constraints do not disappear. When every program demands its promised resources at once, the illusion the OS has sustained can no longer hold.

**Virtual Memory is not a memory technique. It is a technique for hiding constraints.**

Next: The operating system's illusion does not last forever. When it finally breaks, all the costs that were deferred return — in the form of **real system failures.** The next installment examines what happens to a system the moment the illusion shatters.