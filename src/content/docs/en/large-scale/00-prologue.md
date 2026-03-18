---
title: Prologue - What is Large-scale Processing?
description: A definition of large-scale processing from an engineering perspective, integrating the Theory of Constraints (TOC) from business administration.
sidebar:
  order: 1
---

<br>

Large-scale processing is a realm of engineering that transcends the simple notion of "having many users." It refers to the technical strategies employed to ensure service availability and performance without degradation, even when a system reaches the thresholds of its available resources (CPU, Memory, Network Bandwidth).

<br>

### 1. The 3 Axes of Large-scale Systems and Key Metrics
To grasp the scale of high-volume traffic and objectively evaluate a system's processing capacity, we categorize and manage metrics across three dimensions.

<div style="text-align: right; margin-top: -1.0rem;">  
    <a href="https://sre.google/sre-book/monitoring-distributed-systems/">Google SRE: Monitoring Distributed Systems</a>
</div>

<br>

**Traffic (Frequency of Requests and Capacity)**
Measures how many requests enter the system per unit of time and how many simultaneous connections can be maintained.
* **TPS / QPS:** Transactions or Queries Per Second. Represents the system's productivity.
* **Concurrency:** The number of simultaneous connections. Determines the system's capacity during peak events like flash sales or ticket reservations.

**Volume (Size and Flow of Data)**
Refers to the physical size of the data the system must handle and its transmission capability.
* **Throughput:** The amount of data transmitted per unit of time (MB/s). A critical factor in determining bottlenecks in large file transfers or media streaming environments.

**Complexity (Difficulty of Processing and User Experience)**
The amount of computation required to handle a single request and the level of interaction between system components.
* **Latency:** The delay between a request and its response. As internal processing logic becomes more complex, latency increases, directly impacting User Experience (UX).

<br>

### 2. Business Perspective: Theory of Constraints (TOC)

The Theory of Constraints is a management paradigm introduced by Eliyahu M. Goldratt. Its core premise is that "the total output of any system is determined by its weakest link—the <strong>Constraint</strong>."

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.lean.org/lexicon-terms/theory-of-constraints/">Lean Enterprise Institute: TOC</a>
</div>

<br>

**Core Principles of TOC**

* **The Existence of a Bottleneck:** In every complex system, there is always exactly one bottleneck that limits the flow.
* **Global Optimization:** Improving the performance of a non-bottleneck component will not increase the overall system output. 
* **The Shift of the Bottleneck:** Once one bottleneck is resolved, another point in the system becomes the new bottleneck.

<br>

### 3. Bottleneck Management from an Engineering Perspective

In a large-scale processing environment, the engineer's role is to accurately identify resource thresholds and manage bottlenecks. This begins by using metrics to pinpoint which of the three axes (Traffic, Volume, Complexity) is currently acting as the constraint.

* **Bottlenecks Never Disappear:** Resolving a CPU bottleneck might lead to a network throughput bottleneck, which in turn might reveal latency issues caused by logic complexity. Large-scale processing is not about eliminating bottlenecks entirely, but about **strategically moving** them to points with higher bandwidth or capacity.
* **Strategic Resource Allocation:** Viewing a system through the lens of TOC allows for optimal decision-making—focusing resources on the "weakest link" rather than blindly scaling up server instances.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html">AWS Well-Architected Framework</a>
</div>

<br>

### 4. Conclusion

Ultimately, large-scale processing is <strong>Strategic Bottleneck Management</strong>. Throughout this series, we will explore the constraints that arise at each stage—from the network layer to application architecture—and discuss specific strategies to resolve them.