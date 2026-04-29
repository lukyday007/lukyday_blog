---
title: Network Part 4 - Traffic Distribution, Where Do You Split the Load?
description: From the limits of DNS round-robin to the trade-offs of L4/L7 load balancers — where you split traffic determines what your system can and cannot do.
sidebar:
  order: 5
date: 2026-04-29
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 29, 2026</p>

> October 4, 2021. Facebook, Instagram, and WhatsApp went dark simultaneously for nearly six hours. No server crashed. No code was deployed. A routine maintenance command accidentally withdrew all of Facebook's BGP routes — the instructions that tell the rest of the internet how to reach Facebook's data centers. With no route to follow, traffic had nowhere to go. Facebook had vanished from the internet.
>
> The servers were running. The load balancers were running. Everything was fine — except that no traffic could reach any of it. This is what happens when traffic distribution breaks at the routing level. It doesn't matter how well you've built the system behind the load balancer if requests can't find their way in.

<br>
<br>

Not all load balancers work the same way. Some look only at the outside of a packet and route it fast. Others read what's inside before deciding where to send it. In Part 1, we established that L4 is fast because it doesn't look inside, and L7 is slower because it does. Load balancers face the same choice. Which layer do you split traffic at?

<br>

### DNS-Based Load Balancing — The Limits of the Simplest Approach

The most primitive form of load balancing starts at DNS. Register multiple server IPs under a single domain, then rotate which IP gets returned with each request. This is **DNS round-robin**.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.cloudflare.com/learning/dns/glossary/round-robin-dns/">Cloudflare Learning: What is round-robin DNS?</a><br>
  <a href="https://www.cloudflare.com/learning/performance/what-is-dns-load-balancing/">Cloudflare Learning: What is DNS load balancing?</a>
</div>

<div style="margin: 1.5rem 0;">
<div style="display:flex;flex-direction:column;align-items:center;gap:0;">
  <div style="border-radius:8px;padding:10px 20px;font-size:13px;text-align:center;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-4);font-weight:500;width:160px;">Client</div>
  <div style="font-size:16px;color:var(--sl-color-gray-3);line-height:1.4;">↓</div>
  <div style="font-size:11px;color:var(--sl-color-gray-3);margin:-2px 0 2px;">What's example.com?</div>
  <div style="border-radius:8px;padding:10px 20px;font-size:13px;text-align:center;background:#EEEDFE;border:0.5px solid #7F77DD;color:#3C3489;font-weight:500;width:200px;">DNS Server<div style="font-size:11px;color:#534AB7;margin-top:3px;font-weight:400;">Returns a different IP each time</div></div>
  <div style="margin:6px 0 2px;display:flex;gap:12px;justify-content:center;">
    <span style="font-size:10px;padding:2px 6px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;">1st request</span>
    <span style="font-size:10px;padding:2px 6px;border-radius:20px;background:#EAF3DE;color:#3B6D11;border:0.5px solid #639922;">2nd request</span>
    <span style="font-size:10px;padding:2px 6px;border-radius:20px;background:#FAEEDA;color:#854F0B;border:0.5px solid #BA7517;">3rd request</span>
  </div>
  <div style="display:flex;gap:52px;">
    <span style="font-size:14px;color:var(--sl-color-gray-3);">↙</span>
    <span style="font-size:14px;color:var(--sl-color-gray-3);">↓</span>
    <span style="font-size:14px;color:var(--sl-color-gray-3);">↘</span>
  </div>
  <div style="display:flex;gap:12px;margin-top:4px;align-items:stretch;">
    <div style="flex:1 1 0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:500;text-align:center;min-width:80px;background:#E6F1FB;border:0.5px solid #378ADD;color:#185FA5;">Server A<br><span style="font-size:10px;font-weight:400;">192.168.0.1</span></div>
    <div style="flex:1 1 0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:500;text-align:center;min-width:80px;background:#EAF3DE;border:0.5px solid #639922;color:#3B6D11;">Server B<br><span style="font-size:10px;font-weight:400;">192.168.0.2</span></div>
    <div style="flex:1 1 0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:500;text-align:center;min-width:80px;background:#FAEEDA;border:0.5px solid #BA7517;color:#854F0B;">Server C<br><span style="font-size:10px;font-weight:400;">192.168.0.3</span></div>

  </div>
</div>
<div style="margin-top:20px;border:0.5px solid var(--sl-color-gray-5);border-radius:12px;padding:14px 18px;">
  <div style="font-size:13px;font-weight:500;margin-bottom:10px;">Structural limits</div>
  <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--sl-color-gray-2);margin:6px 0;line-height:1.5;"><span style="color:#D85A30;flex-shrink:0;">✗</span><span>Blind to server state — DNS keeps returning Server A even when it's overloaded</span></div>
  <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--sl-color-gray-2);margin:6px 0;line-height:1.5;"><span style="color:#D85A30;flex-shrink:0;">✗</span><span>Can't detect failures — DNS keeps responding with Server B's IP even after it goes down</span></div>
  <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--sl-color-gray-2);margin:6px 0;line-height:1.5;"><span style="color:#D85A30;flex-shrink:0;">✗</span><span>TTL caching — once a client receives an IP, it keeps hitting that server until TTL expires</span></div>
</div>
</div>

The design of DNS round-robin looks flawless on paper. Imagine a theme park with three parking lots — A, B, and C. The navigation app at the entrance distributes cars in order: first car to A, second to B, third to C. Arithmetically perfect.

But the navigation app doesn't check with the server every second. Once it gets directions, it trusts them for a fixed window of time. It sets a timer — "this information is valid for 10 minutes" — and doesn't re-query the server until that timer runs out. That's TTL, the expiration date on a piece of information.

This is where the bottleneck forms. Picture a convoy of tour buses rolling in — hundreds of cars in a single column. The moment the lead car receives directions to Lot A, every car behind it copies that information and heads straight there without ever asking the server. The answer "A is the right call right now" is already locked into every device in the convoy.

The server is ready to send the next group to B and C. But no one's asking. Lot A is gridlocked from the entrance, while B and C sit completely empty.

The server distributed traffic correctly. The only problem is that the cars held onto their directions for 10 minutes and never let go. DNS round-robin can decide who gets what information — but it can't control how long they hold onto it.

**DNS round-robin looks like load balancing. In practice, it's just blind rotation.**

<br>

### L4 Load Balancer — Route Without Opening the Packet

L4 load balancers follow the same philosophy as the L4 layer from Part 1. They never look inside the packet. They check the destination address (IP) and the door number (port), then decide which server to send it to.

<div style="border:0.5px solid var(--sl-color-gray-5);border-radius:12px;padding:1.25rem;margin:1.5rem 0;">
  <div style="font-size:15px;font-weight:500;margin-bottom:4px;">L4 Load Balancer</div>
  <div style="font-size:12px;color:var(--sl-color-gray-2);margin-bottom:16px;">Fast because it never reads the content</div>
  <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;display:inline-block;margin-bottom:12px;">Transport Layer</span>
  <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
    <div style="border-radius:8px;padding:10px 14px;font-size:13px;text-align:center;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);font-weight:500;width:100%;">Client Request</div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="width:100%;border-radius:8px;padding:10px 14px;background:#E6F1FB;border:0.5px solid #378ADD;">
      <div style="font-weight:500;font-size:13px;color:#0C447C;margin-bottom:8px;">L4 Load Balancer</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#185FA5;">IP address</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#185FA5;">Port number</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#D85A30;">✗</span><span style="color:var(--sl-color-gray-2);">Packet content (never opened)</span></div>
    </div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="display:flex;gap:8px;width:100%;align-items:stretch;">
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);">Server A</div>
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);">Server B</div>
    </div>
    <div style="font-size:11px;color:var(--sl-color-gray-2);margin-top:10px;text-align:center;line-height:1.5;">Distributed by IP hash or least connections</div>
  </div>
</div>

Not reading the content means processing is fast. It can handle millions of concurrent connections. Game servers — where thousands of clients are holding simple TCP connections simultaneously — are a natural fit.

The trade-off is clear. Because L4 never opens the packet, it can't route based on what's inside. Sending `/api/payments` to the payments server and `/api/products` to the product server isn't possible at L4. It doesn't know the difference.

<br>

### L7 Load Balancer — Read the Packet, Then Decide

L7 load balancers open the packet and read it. HTTP headers, URL paths, cookies, even the request body. They understand what the request is asking for before deciding where to send it.

<div style="border:0.5px solid var(--sl-color-gray-5);border-radius:12px;padding:1.25rem;margin:1.5rem 0;">
  <div style="font-size:15px;font-weight:500;margin-bottom:4px;">L7 Load Balancer</div>
  <div style="font-size:12px;color:var(--sl-color-gray-2);margin-bottom:16px;">Slower because it reads before routing</div>
  <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;display:inline-block;margin-bottom:12px;">Application Layer</span>
  <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
    <div style="border-radius:8px;padding:10px 14px;font-size:13px;text-align:center;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);font-weight:500;width:100%;">Client Request</div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="width:100%;border-radius:8px;padding:10px 14px;background:#E1F5EE;border:0.5px solid #1D9E75;">
      <div style="font-weight:500;font-size:13px;color:#0F6E56;margin-bottom:8px;">L7 Load Balancer</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">IP address / Port</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">HTTP method / URL</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">Host header</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">Cookie / Request body</span></div>
    </div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="display:flex;gap:8px;width:100%;align-items:stretch;">
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:#E6F1FB;border:0.5px solid #378ADD;color:#185FA5;">Payment Server</div>
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:#EAF3DE;border:0.5px solid #639922;color:#3B6D11;">Product Server</div>
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:#FAEEDA;border:0.5px solid #BA7517;color:#854F0B;">User Server</div>
    </div>
    <div style="font-size:11px;color:var(--sl-color-gray-2);margin-top:10px;text-align:center;line-height:1.5;">Routed by URL path</div>
  </div>
</div>

Reading the URL means `/api/payments` goes to the payments server and `/api/products` goes to the product server. Reading cookies makes **Session Persistence** possible. 
If a user's shopping cart is stored on Server A, that user needs to keep hitting Server A — otherwise the cart disappears. L7 reads the user ID from the cookie and routes every subsequent request from that user to the same server.

The cost is structural. Every request has to be parsed and interpreted before it can be routed. That overhead is higher than L4 by design. As traffic scales, the cost compounds.

<br>

### L4 vs L7 — The Bottleneck Tells You Which One to Use

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:1rem 0;">
  <thead>
    <tr>
      <th style="width:22%;color:var(--sl-color-gray-2);font-size:12px;padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-4);font-weight:400;text-align:left;"></th>
      <th style="width:39%;padding:10px 16px;border-bottom:0.5px solid #378ADD;background:#E6F1FB;color:#0C447C;font-weight:500;text-align:left;">L4 Load Balancer</th>
      <th style="width:39%;padding:10px 16px;border-bottom:0.5px solid #1D9E75;background:#E1F5EE;color:#0F6E56;font-weight:500;text-align:left;">L7 Load Balancer</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Sees</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">IP address, port number</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">HTTP headers, URL, cookies, request body</td>
    </tr>
    <tr style="background:var(--sl-color-bg-nav);">
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Speed</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">Fast</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">Slower</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Routes by</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">Connection count, IP hash</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">URL path, cookies, headers</td>
    </tr>
    <tr style="background:var(--sl-color-bg-nav);">
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Can do</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">Simple TCP distribution</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">Content-based routing<br>A/B testing<br>Session persistence</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;color:var(--sl-color-gray-2);font-size:12px;">Common use</td>
      <td style="padding:10px 16px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;margin-right:4px;">Game servers</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;">High-volume streaming</span>
      </td>
      <td style="padding:10px 16px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;margin-right:4px;">API Gateway</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;">Microservices</span>
      </td>
    </tr>
  </tbody>
</table>

This is where Goldratt's Theory of Constraints — first introduced in Part 1 — applies directly. The constraint isn't always the same. **It depends on where the system is closest to 100% saturation.** The same principle that told us which OSI layer was bottlenecked now tells us which load balancer to reach for.

If concurrent connections are approaching the ceiling, L4. If requests need to be routed based on their content, L7. In practice, many production systems run both in layers — L4 takes the initial traffic and splits it into server groups, L7 handles fine-grained routing within each group.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.haproxy.com/blog/layer-4-and-layer-7-proxy-mode">HAProxy Blog: Layer 4 and Layer 7 Proxy Mode</a>
</div>

<br>


### Risk Pooling — Where You Split Determines the Cost

Supply chain management has a concept called **Risk Pooling**. Whether you consolidate inventory in one warehouse or spread it across multiple regional locations changes the total cost of your operation.

A centralized warehouse handles all orders from one location. Inventory management is simple. Demand spikes anywhere can be absorbed by the same pool. But a customer in Miami ordering from a warehouse in Chicago waits an extra day. Efficient to manage, slow to respond.

Regional warehouses flip the trade-off. A customer in Miami gets same-day delivery from a local facility. Fast. But each warehouse needs its own inventory, its own staff, its own operations. If the Miami warehouse runs out of stock, restocking from Atlanta isn't instant. Fast, but expensive.

Load balancers follow the same logic. **Where you split the traffic determines the latency cost.**

L4 is closer to the centralized model. Everything routes through one fast layer without reading the contents. Throughput is unmatched, but content-based decisions aren't possible. Fast, but coarse.

L7 is closer to the regional model. Every request gets read and sent to the right destination. Precise, but every read costs time. Accurate, but slower.

There's no universal answer. It depends on what you're building.

A game server handling tens of thousands of simultaneous players needs every connection it can get. There's no time to open packets. L4 is the answer. A microservices platform where a misrouted payment request breaks the entire checkout flow needs precision. Reading the URL and routing correctly is worth the overhead. L7 is the answer.

Speed first, or accuracy first. That's the question L4 and L7 are each answering.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://hbr.org/1994/11/from-supply-chain-to-value-chain">HBR: Supply Chain Management and Risk Pooling</a>
</div>

<br>

### The Bottom Line

DNS round-robin assigns turns without knowing server state. L4 routes without opening the packet. L7 reads before routing. Each approach makes a different call on where to absorb the cost — and none of them is universally right.

Choosing where to split traffic isn't a technical decision. It's a trade-off decision. The same question this series has been asking since Part 1: where is the constraint, and what are you willing to give up to resolve it?

**Know where the bottleneck is, and you'll know where to split.**

Next up: everything covered so far — OSI layers, TCP handshake costs, HTTP evolution, load balancing — comes together in real systems. Three scenarios: an e-commerce platform, a live chat service, and a payment system. Where does the bottleneck form, and which choices resolve it?