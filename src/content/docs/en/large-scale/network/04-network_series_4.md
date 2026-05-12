---
title: Network Part 4 - The Load Balancer as an Information Choice
description: From the limits of DNS round-robin to the trade-offs of L4/L7 load balancers — where you split traffic determines what your system can and cannot do.
sidebar:
  order: 5
date: 2026-04-29
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 29, 2026</p>

> On October 4, 2021, Facebook, Instagram, and WhatsApp went dark for six hours all at once. The servers were fine and there was no bad deployment. However, a single command during routine maintenance withdrew Facebook's BGP routes. The internet forgot how to reach their data centers, and traffic had nowhere to go. Facebook simply ceased to exist on the internet.
>
> The servers were running and the load balancers were healthy. Everything was fine, but requests just could not get in. This shows what happens when traffic distribution breaks at the routing layer. No matter how well-built the system is, none of it matters if requests cannot reach the load balancer.

<br>
<br>

Not all load balancers work the same way. Some look only at the outside of a packet to route it fast. Others open the packet, read the contents, and then decide. In Network Part 1, the trade-off was clear. **L4 is fast because it stays ignorant**, and **L7 is precise because it pays to know**. Load balancers face this same choice. You must decide which layer to split your traffic at.

<br>

## DNS Round Robin — Blind by Design

The most primitive form of load balancing starts at DNS. Multiple server IPs are registered under one domain. The DNS server then hands out a different IP in rotation for each incoming request. This is **DNS round-robin**.

*Reference: [Cloudflare Learning: What is round-robin DNS?](https://www.cloudflare.com/learning/dns/glossary/round-robin-dns/)*  <br>
*Reference: [Cloudflare Learning: What is DNS load balancing?](https://www.cloudflare.com/learning/performance/what-is-dns-load-balancing/)*


```
                ┌───────────────┐
                │     Client    │
                └───────────────┘
                        ↓
              "What's example.com?"
                        ↓
    ┌──────────────────────────────────────┐
    │               DNS Server             │
    │  (Returns a different IP each time)  │
    └──────────────────────────────────────┘
        ┌───────────────┼───────────────┐
  [1st request]   [2nd request]    [3rd request]
       ↙                ↓                ↘
 ┌────────────┐   ┌────────────┐   ┌────────────┐
 │  Server A  │   │ Server B   │   │  Server C  │
 │192.168.0.1 │   │192.168.0.2 │   │192.168.0.3 │
 └────────────┘   └────────────┘   └────────────┘
```

DNS round-robin looks balanced in theory, but it suffers from a fatal **structural disconnect**.
- **Blind to server state**: DNS keeps returning Server A even when it is overloaded.
- **No failure detection**: DNS continues responding with an IP even after that server goes down.
- **TTL caching**: Once a client receives an IP, it hits that same server until the TTL expires.

Imagine a theme park with three parking lots — A, B, and C. The navigation app at the entrance sends cars in rotation: first to A, next to B, then C. Arithmetically balanced.

However, the app does not check the actual lot status every time. It trusts a cached answer for a fixed window. "This information is valid for 10 minutes." The timer starts, and the server goes unchecked. This is **TTL (Time-To-Live)**, an expiration date on information.
 
This is where the breakdown happens. Picture a convoy of tourist buses arriving back-to-back. The first bus receives "Go to Lot A." Every bus behind it copies that answer without asking again because the information is already cached. The server is ready to send the next group to Lots B and C, but the buses are no longer asking. Lot A becomes jammed while Lots B and C sit empty.

This imbalance occurs because of a **time-lag between the party with the information and the party making the decision**. The DNS server might know Server A is overloaded, but the client won't find out until the TTL expires. The distribution gets skewed, not because caching is broken, but because the decision-making is decoupled from the real-time state.

**DNS round-robin looks like load balancing. In practice, it's blind rotation.**

<br>


## L4 Load Balancer — Fast by Choice

The L4 load balancer follows the same philosophy introduced in Network Part 1. It does not open the packet. Instead, it reads only the destination IP address and port number on the envelope and decides where to send it from there.

```
[Transport Layer]

            ┌───────────────────┐
            │   Client Request  │
            └───────────────────┘      
                      ↓
      ┌────────────────────────────────┐
      │        L4 Load Balancer        │
      │                                │
      │         ✓ IP address           │
      │       ✓ Check Port number      │
      │        ✗ Packet content        │
      └────────────────────────────────┘    
        ↙             ↓             ↘
  ┌───────────┐ ┌───────────┐ ┌───────────┐
  │ Server A  │ │ Server B  │ │ Server C  │
  └───────────┘ └───────────┘ └───────────┘      
  ( Based on IP hash or least connections )        
```

No content inspection results in extremely fast decisions. This allows the system to handle millions of concurrent connections. It fits environments where large numbers of clients open simple TCP connections simultaneously, such as game servers or streaming services.

L4 is a strategy defined by **intentional ignorance**. It makes routing decisions without knowing what is inside the packet. While DNS round-robin failed because it lacked necessary information, L4 turns that same lack of knowledge into a deliberate choice. L4 trades the benefit of knowing for the benefit of speed.

The structural limits follow directly from this choice.

- **No content visibility**: The system cannot perform URL-based routing.
- **Routing restrictions**: It is impossible to send `/api/payments` to a specific cluster while sending `/api/products` to another.
- **No session persistence**: The load balancer cannot read cookies, so it cannot maintain specific user sessions based on application data.

L4 creates the fastest possible path at the most primitive level because it refuses to pay the time cost required to gather more information.

<br>


## L7 Load Balancer — Informed by Design

The L7 load balancer operates at the application layer. It inspects each packet thoroughly. It checks HTTP headers, URL paths, cookies, and even the request body. The system uses this information to find the specific server that handles that content.

```
[Application Layer]
 
              ┌───────────────────┐
              │   Client Request  │
              └───────────────────┘
                        ↓
            ┌────────────────────────┐
            │    L7 Load Balancer    │
            │                        │
            │  ✓ IP address / port   │
            │  ✓ HTTP method / URL   │
            │  ✓ Host header         │
            │  ✓ Cookies / body      │
            └────────────────────────┘
          ↙             ↓             ↘
    ┌───────────┐  ┌──────────┐   ┌──────────┐
    │  Payment  │  │  Product │   │   User   │
    │  Server   │  │  Server  │   │  Server  │
    └───────────┘  └──────────┘   └──────────┘
          ( Routing based on URL path )
```

L7 routing is highly sophisticated because the system can see the data.
- **Path-based routing**: It sends /api/payments to the payment server. It sends /api/products to the product server.
- **Session persistence**: The system reads cookies to identify users. If a user’s data exists only on Server A, the load balancer keeps sending that user back to Server A.

This is a **strategy of paying to close the information gap**. Analyzing headers and inspecting URLs is the price of knowing. In exchange for this cost, L7 makes precise decisions that L4 cannot. L4 is like a fast highway tollgate, while L7 acts like a concierge service.

The trade-off is structural. Every request must be parsed and interpreted. This means the overhead is higher than L4. As traffic grows, this cost continues to stack. The system **invests information into every decision** to achieve better resource allocation.

<br>

## L4 vs L7 — Where the Bottleneck Is

| Category | L4 Load Balancer | L7 Load Balancer |
| :--- | :--- | :--- |
| **Sees** | IP address, port | HTTP headers, URL, cookies |
| **Speed** | Fast | Slower |
| **Routes by** | Connection count, IP | URL path, cookies, headers |
| **Can do** | Simple TCP distribution | Content routing, A/B testing |
| **Common use** | Game servers, streaming | API Gateway, microservices |

Goldratt's Theory of Constraints from Network Part 1 applies directly here. The constraint is never fixed — **it's wherever the system is closest to 100% saturation**. The question of which OSI layer is the bottleneck becomes the question of which load balancer to use.

If concurrent connections are approaching the limit, L4 is the answer. 
If requests must be routed based on specific content, L7 is the answer. 

In practice, many production systems layer both. L4 receives the traffic first to distribute it across server groups. Then, L7 handles fine-grained routing within each group.

*Reference: [HAProxy Blog: Layer 4 and Layer 7 Proxy Mode](https://www.haproxy.com/blog/layer-4-and-layer-7-proxy-mode)*


<br>

## Own the Information, or Let It Go

Three systems face the same problem but provide three different answers.


DNS round-robin fails because of a huge gap. There is a gap between the server state and the client's judgment. Economist George Akerlof called this **Information Asymmetry** in his paper "The Market for Lemons." In the used car market, sellers know the defects but buyers do not. This gap distorts the entire market. Network distribution breaks down the same way. The server is dying, but the client does not know it.

*Reference: [Information Asymmetry](https://en.wikipedia.org/wiki/The_Market_for_Lemons/)*

The history of load balancing is about choosing how to handle this asymmetry.

### Three Strategies for the Information Gap
- DNS round-robin ignores the gap. It assigns slots **without knowing the server state**. The result is unpredictable because the distribution is distorted.
- L4 load balancer acknowledges the gap. It accepts it. It makes decisions **without knowing the packet contents**. This strategy turns ignorance into an asset. It gains speed by giving up information.
- L7 load balancer chooses to close the gap. **It pays the price in parsing time.** It gains precision in return. It spends performance as a transaction cost to get fine-grained control.


Akerlof showed a key point. Information gaps are not always bad. **How the gap is handled determines the outcome.** Used car markets that ignored the gap collapsed. Markets that bridged it with warranties survived.

Load balancers follow this same logic. Ignore the gap and you get DNS. Accept the gap and you get L4. Close the gap and you get L7. **The question is not whether the gap exists. It is what the system does with it.**

This structure runs through every part of this series. Goldratt asked where the constraint is. Coase and Williamson explained when transaction costs make sense. Akerlof showed how information gaps split behavior. The names change across four parts, but the question is the same.

**Where is the bottleneck right now? What is the system willing to give up to clear it?**

<br>


## The Bottom Line

The layer where traffic is split is not a matter of technical preference. It is a trade-off decision. This returns to the same question from Network Part 1. Where is the constraint, and what must be given up to resolve it?

**Knowing where the bottleneck is shows where to split.**
**Knowing how to handle the information gap shows how to split.**

Next up: everything covered so far — OSI layers, TCP handshake costs, HTTP evolution, load balancing — comes together in real systems. Three scenarios: an e-commerce platform, a live chat service, and a payment system. Where does the bottleneck form, and which choices resolve it?