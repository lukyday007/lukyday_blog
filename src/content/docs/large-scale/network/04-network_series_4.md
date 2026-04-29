---
title: 네트워크 4편 - 트래픽 분산, 부하를 어디서 나눌 것인가
description: DNS 라운드로빈의 한계부터 L4/L7 로드밸런서의 트레이드오프까지 — 어느 계층에서 트래픽을 나눌 것인가가 시스템의 성능을 결정한다.
sidebar:
  order: 5
date: 2026-04-29
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">작성일: 2026년 4월 29일</p>

> 2021년 10월 4일. Facebook, Instagram, WhatsApp이 동시에 약 6시간 동안 완전히 먹통이 됐다. 서버가 다운된 것도 아니었고, 잘못된 코드가 배포된 것도 아니었다. 정기 점검 중 실수로 실행된 명령 하나가 Facebook의 모든 BGP 라우트를 철회했다. 인터넷이 Facebook의 데이터센터로 가는 길을 잃어버린 것이다. 트래픽은 갈 곳을 잃었고, Facebook은 인터넷에서 사라졌다.
>
> 서버는 멀쩡히 돌아가고 있었다. 로드밸런서도 정상이었다. 모든 것이 괜찮았다. 단지 요청이 아무것도 닿지 못했을 뿐이다. 트래픽 분산이 라우팅 단계에서 무너지면 이렇게 된다. 로드밸런서 뒤에 아무리 잘 만든 시스템이 있어도, 요청이 들어오지 못하면 아무 의미가 없다.

<br>
<br>

로드밸런서도 모두 같은 방식으로 동작하지 않는다. 어떤 것은 패킷의 겉만 보고 빠르게 분배하고, 어떤 것은 패킷의 내용을 읽어보고 어디로 보낼지 판단한다. 네트워크 1편에서 L4는 내용을 모르는 대신 빠르고, L7은 아는 대신 느리다고 했다. 로드밸런서도 똑같은 선택 앞에 선다. 어느 계층에서 트래픽을 나눌 것인가.

<br>

### DNS 기반 로드밸런싱 — 가장 단순한 분산의 한계

로드밸런싱의 가장 원시적인 형태는 DNS에서 시작한다. 도메인 하나에 여러 서버의 IP를 등록해두고, 요청이 들어올 때마다 순서대로 다른 IP를 돌려주는 방식이다. 이것이 <strong>DNS 라운드로빈(Round Robin)</strong>이다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.cloudflare.com/learning/dns/glossary/round-robin-dns/">Cloudflare Learning: What is round-robin DNS?</a><br>
  <a href="https://www.cloudflare.com/learning/performance/what-is-dns-load-balancing/">Cloudflare Learning: What is DNS load balancing?</a><br>
</div>

<div style="margin: 1.5rem 0;">
<div style="display:flex;flex-direction:column;align-items:center;gap:0;">
  <div style="border-radius:8px;padding:10px 20px;font-size:13px;text-align:center;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-4);font-weight:500;width:160px;">클라이언트</div>
  <div style="font-size:16px;color:var(--sl-color-gray-3);line-height:1.4;">↓</div>
  <div style="font-size:11px;color:var(--sl-color-gray-3);margin:-2px 0 2px;">example.com 이 뭐야?</div>
  <div style="border-radius:8px;padding:10px 20px;font-size:13px;text-align:center;background:#EEEDFE;border:0.5px solid #7F77DD;color:#3C3489;font-weight:500;width:200px;">DNS 서버<div style="font-size:11px;color:#534AB7;margin-top:3px;font-weight:400;">순서대로 다른 IP 응답</div></div>
  <div style="margin:6px 0 2px;display:flex;gap:12px;justify-content:center;">
    <span style="font-size:10px;padding:2px 6px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;">1번째 요청</span>
    <span style="font-size:10px;padding:2px 6px;border-radius:20px;background:#EAF3DE;color:#3B6D11;border:0.5px solid #639922;">2번째 요청</span>
    <span style="font-size:10px;padding:2px 6px;border-radius:20px;background:#FAEEDA;color:#854F0B;border:0.5px solid #BA7517;">3번째 요청</span>
  </div>
  <div style="display:flex;gap:52px;">
    <span style="font-size:14px;color:var(--sl-color-gray-3);">↙</span>
    <span style="font-size:14px;color:var(--sl-color-gray-3);">↓</span>
    <span style="font-size:14px;color:var(--sl-color-gray-3);">↘</span>
  </div>
    <div style="display:flex;gap:12px;margin-top:4px;align-items:stretch;">
    <div style="flex:1 1 0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:500;text-align:center;min-width:80px;background:#E6F1FB;border:0.5px solid #378ADD;color:#185FA5;">서버 A<br><span style="font-size:10px;font-weight:400;">192.168.0.1</span></div>
    <div style="flex:1 1 0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:500;text-align:center;min-width:80px;background:#EAF3DE;border:0.5px solid #639922;color:#3B6D11;">서버 B<br><span style="font-size:10px;font-weight:400;">192.168.0.2</span></div>
    <div style="flex:1 1 0;border-radius:8px;padding:10px 16px;font-size:12px;font-weight:500;text-align:center;min-width:80px;background:#FAEEDA;border:0.5px solid #BA7517;color:#854F0B;">서버 C<br><span style="font-size:10px;font-weight:400;">192.168.0.3</span></div>
  </div>
</div>
<div style="margin-top:20px;border:0.5px solid var(--sl-color-gray-5);border-radius:12px;padding:14px 18px;">
  <div style="font-size:13px;font-weight:500;margin-bottom:10px;">구조적 한계</div>
  <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--sl-color-gray-2);margin:6px 0;line-height:1.5;"><span style="color:#D85A30;flex-shrink:0;">✗</span><span>서버 상태를 모른다 — 서버 A가 과부하 상태여도 DNS는 순서대로 A를 돌려준다</span></div>
  <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--sl-color-gray-2);margin:6px 0;line-height:1.5;"><span style="color:#D85A30;flex-shrink:0;">✗</span><span>장애를 감지하지 못한다 — 서버 B가 죽어있어도 DNS는 계속 B의 IP를 응답한다</span></div>
  <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--sl-color-gray-2);margin:6px 0;line-height:1.5;"><span style="color:#D85A30;flex-shrink:0;">✗</span><span>TTL 캐싱 문제 — 한 번 IP를 받은 클라이언트는 TTL이 만료될 때까지 같은 서버로만 요청한다</span></div>
</div>
</div>

DNS 라운드로빈의 설계는 이론상 완벽해 보인다. 예를 들어 테마파크에 주차장이 A, B, C 세 곳이 있다면, 입구의 내비게이션 앱은 차들을 순서대로 분산시킨다. 첫 번째 차는 A, 두 번째는 B, 세 번째는 C로. 산술적으로는 균형 잡힌 분산이다.

하지만 내비게이션 앱은 그때마다 서버에 요청하지 않는다. 한 번 받은 안내를 일정 시간 동안 그대로 신뢰한다. "이 정보는 10분간 유효함"이라는 타이머를 켜고, 그동안은 서버를 다시 확인하지 않는다. 
이것이 TTL(Time-To-Live), 정보의 유통기한이다.

여기서 병목이 발생한다. 수백 대의 차가 줄지어 진입하는 관광버스 군단을 생각해보자. 
맨 앞 차가 "A 주차장으로 가세요"라는 안내를 받는 순간, 뒤따르는 모든 차는 서버에 묻지도 않고 그 정보를 복사해 A로만 향한다. 
이미 각자의 기기에 "지금은 A가 답이다"라는 정보로 고정되었기 때문이다.

서버는 다음 관광버스에게 주차장 B와 C를 안내할 준비가 끝났지만, 정작 버스들은 다른 주차장을 찾지 않는다. A 주차장은 입구부터 터져 나가는데, B와 C는 텅텅 비어있는 기현상이 벌어진다.

서버는 분명 골고루 안내했다. 잘못이 있다면 정보를 받은 차들이 그 정보를 10분 동안 버리지 않았다는 것뿐이다. 
DNS 라운드로빈은 "누구에게 무엇을 줄지"는 결정할 수 있어도, 상대방이 그 정보를 "얼마나 오래 붙들고 있을지"는 통제할 수 없다. 

따라서 **DNS 라운드로빈은 분산처럼 보이지만, 실제로는 맹목적인 순번 배정에 불과하다.**

<br>

### L4 로드밸런서 — 패킷을 열지 않고 빠르게 분배한다

L4 로드밸런서는 1편에서 말한 L4의 철학을 그대로 따른다. 패킷의 내용을 열어보지 않는다. 봉투에 적힌 받는 사람 주소(IP 주소)와 우편번호(포트 번호)만 확인하고 어느 서버로 보낼지 결정한다.

<div style="border:0.5px solid var(--sl-color-gray-5);border-radius:12px;padding:1.25rem;margin:1.5rem 0;">
  <div style="font-size:15px;font-weight:500;margin-bottom:4px;">L4 로드밸런서</div>
  <div style="font-size:12px;color:var(--sl-color-gray-2);margin-bottom:16px;">속도를 위해 인식을 포기한다</div>
  <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;display:inline-block;margin-bottom:12px;">Transport Layer</span>
  <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
    <div style="border-radius:8px;padding:10px 14px;font-size:13px;text-align:center;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);font-weight:500;width:100%;">클라이언트 요청</div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="width:100%;border-radius:8px;padding:10px 14px;background:#E6F1FB;border:0.5px solid #378ADD;">
      <div style="font-weight:500;font-size:13px;color:#0C447C;margin-bottom:8px;">L4 로드밸런서</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#185FA5;">IP 주소</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#185FA5;">포트 번호</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#D85A30;">✗</span><span style="color:var(--sl-color-gray-2);">패킷 내용 (열지 않음)</span></div>
    </div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="display:flex;gap:8px;width:100%;align-items:stretch;">
        <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);">서버 A</div>
        <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);">서버 B</div>
    </div>
    <div style="font-size:11px;color:var(--sl-color-gray-2);margin-top:10px;text-align:center;line-height:1.5;">IP 해시 또는 최소 연결 수 기준</div>
  </div>
</div>

내용을 읽지 않으니 처리 속도가 빠르다. 수백만 개의 연결을 동시에 처리할 수 있다. 게임 서버처럼 수많은 클라이언트가 단순 TCP 연결을 동시에 맺는 환경에 적합하다. 어떤 게임을 하고 있는지 알 필요가 없다. 연결만 계속 처리하면 된다.

단, 패킷을 열어보지 않기 때문에 할 수 없는 것도 있다. 특정 사용자를 특정 서버로 보내거나, 요청 URL이 `/api/payments`인지 `/api/products`인지에 따라 다른 서버로 라우팅이 불가능하다. 
<br>


### L7 로드밸런서 — 패킷의 내용을 읽고 판단한다

L7 로드밸런서는 패킷을 열어서 읽는다. HTTP 헤더, URL 경로, 쿠키, 심지어 요청 본문까지. 봉투를 열어 편지 내용을 확인한 뒤, 그 내용에 맞는 담당자에게 전달하는 방식이다.

<div style="border:0.5px solid var(--sl-color-gray-5);border-radius:12px;padding:1.25rem;margin:1.5rem 0;">
  <div style="font-size:15px;font-weight:500;margin-bottom:4px;">L7 로드밸런서</div>
  <div style="font-size:12px;color:var(--sl-color-gray-2);margin-bottom:16px;">인식을 위해 속도를 포기한다</div>
  <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;display:inline-block;margin-bottom:12px;">Application Layer</span>
  <div style="display:flex;flex-direction:column;align-items:center;gap:0;">
    <div style="border-radius:8px;padding:10px 14px;font-size:13px;text-align:center;background:var(--sl-color-bg-nav);border:0.5px solid var(--sl-color-gray-5);font-weight:500;width:100%;">클라이언트 요청</div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="width:100%;border-radius:8px;padding:10px 14px;background:#E1F5EE;border:0.5px solid #1D9E75;">
      <div style="font-weight:500;font-size:13px;color:#0F6E56;margin-bottom:8px;">L7 로드밸런서</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">IP 주소 / 포트</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">HTTP 메서드 / URL</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">호스트 헤더</span></div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;"><span style="color:#1D9E75;">✓</span><span style="color:#0F6E56;">쿠키 / 요청 본문</span></div>
    </div>
    <div style="font-size:18px;color:var(--sl-color-gray-3);line-height:1.2;">↓</div>
    <div style="display:flex;gap:8px;width:100%;align-items:stretch;">
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:#E6F1FB;border:0.5px solid #378ADD;color:#185FA5;">결제 서버</div>
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:#EAF3DE;border:0.5px solid #639922;color:#3B6D11;">상품 서버</div>
      <div style="flex:1 1 0;text-align:center;border-radius:8px;padding:8px 4px;font-size:11px;font-weight:500;background:#FAEEDA;border:0.5px solid #BA7517;color:#854F0B;">사용자 서버</div>
    </div>
    <div style="font-size:11px;color:var(--sl-color-gray-2);margin-top:10px;text-align:center;line-height:1.5;">URL 경로 기준으로 라우팅</div>
  </div>
</div>

URL을 읽을 수 있으니 `/api/payments`는 결제 서버로, `/api/products`는 상품 서버로 보낼 수 있다. 쿠키 또한 확인이 가능해 **세션 고정(Session Persistence)**도 가능하다. 
쇼핑몰에서 장바구니에 담은 상품 정보가 서버 A에만 저장되어 있다면, 그 사용자는 계속 서버 A로 가야 장바구니가 유지된다. L7은 쿠키 안의 사용자 ID를 읽고 매번 같은 서버로 보낸다. 

대신 패킷을 열어서 읽는다는 것은 시간이 걸린다는 뜻이다. 모든 요청을 파싱하고 해석하는 비용이 L4보다 구조적으로 높다. 트래픽이 늘수록 이 비용이 누적된다.

<br>

### L4 vs L7 — 지금 병목이 어디인지가 답을 결정한다

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:1rem 0;">
  <thead>
    <tr>
      <th style="width:22%;color:var(--sl-color-gray-2);font-size:12px;padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-4);font-weight:400;text-align:left;"></th>
      <th style="width:39%;padding:10px 16px;border-bottom:0.5px solid #378ADD;background:#E6F1FB;color:#0C447C;font-weight:500;text-align:left;">L4 로드밸런서</th>
      <th style="width:39%;padding:10px 16px;border-bottom:0.5px solid #1D9E75;background:#E1F5EE;color:#0F6E56;font-weight:500;text-align:left;">L7 로드밸런서</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">보는 것</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">IP 주소, 포트 번호</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">HTTP 헤더, URL, 쿠키, 요청 본문</td>
    </tr>
    <tr style="background:var(--sl-color-bg-nav);">
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">처리 속도</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">빠름</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">느림</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">판단 기준</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">연결 수, IP 해시</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">URL 경로, 쿠키, 헤더</td>
    </tr>
    <tr style="background:var(--sl-color-bg-nav);">
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">할 수 있는 것</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">단순 TCP 분산</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">내용 기반 라우팅<br>A/B 테스트<br>세션 고정</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;color:var(--sl-color-gray-2);font-size:12px;">주요 사례</td>
      <td style="padding:10px 16px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;margin-right:4px;">게임 서버</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;">대용량 스트리밍</span>
      </td>
      <td style="padding:10px 16px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;margin-right:4px;">API Gateway</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;">마이크로서비스</span>
      </td>
    </tr>
  </tbody>
</table>

1편에서 처음 소개한 골드랫의 제약이론(TOC)이 여기서도 그대로 적용된다. 제약 요인은 항상 다르다. **시스템이 Saturation 100%에 가장 가까운 지점이 어디냐에 따라 달라진다.** 어느 OSI 계층이 병목인지 물었던 그 질문은 이제 어느 로드밸런서를 써야 하는지의 질문으로 이어진다.

동시 연결 수가 한계에 다가서고 있다면 L4다. 요청의 내용에 따라 다른 처리가 필요하다면 L7이다. 실제 시스템에서는 L4와 L7을 계층적으로 함께 쓰는 경우도 많다. L4가 먼저 트래픽을 받아서 서버 그룹으로 나누고, L7이 그 안에서 세부 라우팅을 담당하는 구조다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.haproxy.com/blog/layer-4-and-layer-7-proxy-mode">HAProxy Blog: Layer 4 and Layer 7 Proxy Mode</a>
</div>

<br>

### Risk Pooling - 재고를 어디서 나눌 것인가

물류 경영학에는 **Risk Pooling**이라는 개념이 있다. 재고를 한 창고에 모아둘지, 여러 지역에 분산할지에 따라 전체 물류 비용이 달라진다는 이론이다.

중앙 집중형 창고를 보자. 전국의 모든 주문을 하나의 창고에서 처리한다. 재고를 한 곳에 모으면 관리가 단순하다. 수요 예측도 쉽다. 한 지역에서 갑자기 수요가 폭증해도, 다른 지역의 재고를 끌어와 대응할 수 있다. 다만 부산에 거주한 고객이 주문한 물품이 서울 창고에서 출발하니 배송에 하루가 더 걸린다. 관리는 효율적이지만 응답이 느리다.

분산형 창고는 반대다. 서울, 부산, 광주에 각각 창고를 둔다. 부산 거주 고객의 주문은 부산 창고에서 바로 출발하니 당일 도착한다. 응답은 빠르다. 다만 각 창고마다 재고를 따로 관리해야 하니 운영 비용이 늘어난다. 부산 창고의 재고가 떨어지면 다른 지역에서 끌어오는 것도 즉각적이지 않다. 빠른 대신 비싸다.

로드밸런서의 선택도 같은 구조다. **어디서 나눌지가 지연시간(물류 비용)을 결정한다.**

L4는 중앙 집중형에 가깝다. 모든 요청을 한 곳에서 빠르게 분배한다. 패킷을 열어보지 않으니 처리 속도는 압도적으로 빠르지만, 요청의 내용에 따라 다른 처리를 할 수는 없다. 분배는 빠르지만 단순하다.

L7은 분산형에 가깝다. 각 요청의 내용을 읽고 가장 적합한 서버로 보낸다. 결제 요청은 결제 전용 서버로, 상품 조회는 상품 서버로. 정확하고 세밀하지만, 매번 패킷을 열어보고 판단하는 비용이 든다. 정확한 대신 느리다.

정답은 없다. 어떤 서비스를 만드느냐에 따라 우선순위가 달라지기 때문이다.

동시 접속자가 폭증하는 게임 서버라면 속도가 전부다. 한 명이라도 더 많이 접속가능하기 위한 환경을 구축해야한다. 패킷을 열어볼 시간이 없다. 이때는 L4가 답이다.

반대로 마이크로서비스 환경에서는 요청이 정확한 서버에 도달해야 한다. 결제 요청이 상품 서버로 가면 서비스가 망가진다. URL을 읽고 판단해야 한다. 처리 속도를 일부 희생하더라도 L7이 필요하다.

속도가 먼저인가, 정확도가 먼저인가. 그 답이 L4와 L7 사이의 선택을 결정한다.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://hbr.org/1994/11/from-supply-chain-to-value-chain">HBR: Supply Chain Management and Risk Pooling</a>
</div>

<br>

### 정리하며

DNS 라운드로빈은 서버 상태를 모른 채 순번만 배정한다. L4는 패킷을 열지 않고 빠르게 분배한다. L7은 패킷을 읽고 정확하게 라우팅한다. 각 방식은 비용을 어디서 감당할지에 대해 서로 다른 선택을 한다. 어느 것도 항상 옳지 않다.

어느 계층에서 트래픽을 나눌 것인가는 기술 선택이 아니라 트레이드오프 선택이다. 1편부터 이 시리즈가 계속 던져온 질문과 같다. 제약은 어디에 있는가, 그리고 그것을 해소하기 위해 무엇을 포기할 것인가.

**병목이 어디인지 알면, 어디서 나눠야 하는지도 알 수 있다.**

다음 편에서는 지금까지 배운 모든 개념이 실제 시스템에서 어떻게 맞물리는지를 살펴본다. 쇼핑몰, 채팅, 결제 — 세 가지 시나리오를 통해 병목이 어디서 생기고, 어떤 선택이 그것을 해소하는지를 들여다본다.