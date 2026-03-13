---
title: Core CS Fundamentals Summary
description: Essential Computer Science knowledge for understanding high-scale traffic handling.
sidebar:
  order: 1
---

Solid CS fundamentals are the fundamental strength required to solve problems in complex distributed systems. Here is a summary of key keywords by major subject.

---

## 1. Network
Understand how data moves securely and quickly between servers and clients.

* **Key Keywords:** TCP/UDP, HTTP/HTTPS (1.1, 2.0, 3.0), DNS, OSI 7 Layers, TLS Handshake, Load Balancing (L4/L7).
* **High-Scale Perspective:** "How does HTTP/2 Multiplexing improve loading speeds for high-volume images?"



[Image of OSI 7 layers model]


---

## 2. Operating System (OS)
Learn how to efficiently manage server resources such as CPU and Memory.

* **Key Keywords:** Process vs. Thread, Multi-threading, Context Switching, Memory Management (Virtual Memory, Paging), System Calls, I/O Models (Blocking vs. Non-Blocking).
* **High-Scale Perspective:** "Why is Non-Blocking I/O necessary to handle tens of thousands of concurrent connections?"



---

## 3. Database (DB)
Covers strategies for storing data safely and retrieving it quickly.

* **Key Keywords:** Transaction (ACID), Index (B-Tree, Hash), Execution Plan, Join Optimization, Normalization vs. Denormalization, Isolation Levels.
* **High-Scale Perspective:** "Solving performance degradation when querying data from a table with 10 million rows without an index."



---

## 4. Data Structure
Select the optimal data storage method for a given situation.

* **Key Keywords:** Array vs. List, Hash Map (The magic of O(1)), Stack/Queue, Tree (B-Tree, Trie), Graph.
* **High-Scale Perspective:** "Why do caching systems like Redis internally use Hash Tables or Skip Lists?"

---

## 5. Java & Spring
Tools for building enterprise-grade backend systems.

* **Key Keywords:** JVM Architecture (GC Optimization), SOLID Principles, DI/IoC, AOP, Spring Bean Scopes, JPA/Hibernate.
* **High-Scale Perspective:** "Minimizing server response latency through JVM Garbage Collection (GC) tuning."