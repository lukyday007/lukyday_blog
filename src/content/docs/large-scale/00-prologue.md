---
title: 프롤로그 - 대용량 처리(Large-scale Processing)란 무엇인가?? 
description: 대용량 처리의 본질과 경영학의 제약이론(TOC)을 결합한 엔지니어링 관점의 정의
sidebar:
  order: 1
---

<br>

대용량 처리는 단순히 "사용자가 많다"는 현상을 넘어선 엔지니어링의 영역이다. 시스템이 가용 가능한 자원(CPU, Memory, Network Bandwidth)의 임계점에 도달했을 때, 성능 저하 없이 요청을 완수하고 서비스의 가용성을 보장하기 위한 기술적 전략을 의미한다.

<br>

### 1. 대용량 시스템을 정의하는 3가지 축과 핵심 지표
대용량 트래픽의 규모를 파악하고 시스템의 처리 능력을 객관적으로 평가하기 위해 지표들을 3가지 차원으로 분류하여 관리한다.

<div style="text-align: right; margin-top: -1.0rem;">  
    <a href="https://sre.google/sre-book/monitoring-distributed-systems/">Google SRE: Monitoring Distributed Systems</a>
</div>

<br>

**트래픽 (Traffic: 요청의 빈도와 수용량)**
단위 시간당 얼마나 많은 요청이 들어오는가, 그리고 얼마나 많은 연결을 유지할 수 있는가를 측정한다.
* **TPS / QPS:** 초당 처리되는 트랜잭션 또는 쿼리 수. 시스템의 생산성을 나타낸다.
* **Concurrency:** 동일 시점에 유지되는 연결(Connection) 수. 티켓팅이나 이벤트 상황에서 시스템의 수용량을 결정한다.

**데이터 양 (Volume: 데이터의 크기와 흐름)**
시스템이 처리해야 할 데이터의 물리적 크기와 전송 능력을 의미한다.
* **Throughput:** 단위 시간당 전송되는 데이터 크기(MB/s). 대용량 파일 전송이나 미디어 스트리밍 환경에서 시스템의 병목을 결정짓는 핵심 요소다.

**복잡도 (Complexity: 처리의 난이도와 사용자 경험)**
요청 하나를 처리하기 위해 필요한 연산량과 시스템 간 상호작용의 수준이다.
* **Latency:** 요청부터 응답까지의 지연 시간. 시스템 내부의 처리 로직이 복잡해질수록 응답 시간은 길어지며, 이는 곧 사용자 경험(UX)의 저하로 직결된다.

<br>

### 2. 경영학 관점: 제약이론(Theory of Constraints, TOC)

엘리야후 골드랫(Eliyahu M. Goldratt)이 제시한 경영 관리 패러다임이다. "시스템의 전체 산출물은 가장 취약한 사슬, 즉 <strong>제약 요인(Constraint)</strong>에 의해 결정된다"는 것이 핵심이다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.lean.org/lexicon-terms/theory-of-constraints/">Lean Enterprise Institute: TOC</a>
</div>

<br>

**TOC의 핵심 원칙**

* **병목(Bottleneck)의 존재:** 모든 시스템에는 흐름을 방해하는 단 하나의 병목이 반드시 존재한다.
* **전체 최적화:** 병목이 아닌 부분의 성능을 아무리 개선해도 시스템 전체의 생산량은 늘어나지 않는다.
* **병목의 이동:** 하나의 병목을 해결하면, 시스템의 다른 지점이 새로운 병목이 된다.

<br>

### 3. 엔지니어링 관점의 병목 관리

대용량 처리 환경에서 엔지니어의 역할은 시스템의 자원 임계점을 정확히 파악하고 병목을 관리하는 것이다. 앞서 언급한 세 가지 축(Traffic, Volume, Complexity) 중 현재 우리의 시스템이 어떤 제약 사항에 걸려 있는지 지표를 통해 찾아내는 것이 시작이다.

* **병목은 사라지지 않는다:** TPS를 높여 트래픽 문제를 해결하면 네트워크 Throughput이 병목이 되고, 이를 해결하면 로직의 Complexity로 인한 Latency가 발목을 잡는다. 대용량 처리는 병목을 완전히 없애는 것이 아니라, 이를 더 넓은 대역폭을 가진 지점으로 전략적으로 이동시키는 과정이다.
* **리소스의 효율적 배치:** TOC 관점에서 시스템을 바라보면, 무작정 서버 인스턴스를 늘리는 대신 '가장 약한 고리'를 찾아 자원을 집중 투입하는 최적의 의사결정이 가능해진다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html">AWS Well-Architected Framework</a>
</div>

<br>

### 4. 정리하며

대용량 처리는 곧 <strong>전략적 병목 관리(Strategic Bottleneck Management)</strong>다. 앞으로의 연재를 통해 네트워크 계층부터 애플리케이션 아키텍처까지, 각 단계에서 발생하는 제약 요인을 지표로 확인하고 이를 어떻게 해소하는지 다룰 예정이다.