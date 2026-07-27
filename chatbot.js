/* GOFA SHIPPING - Smart FAQ Assistant
 * A lightweight, rule-based chatbot. No API key or backend required.
 * It builds its own widget and answers common shipping questions.
 */
(function () {
  // ---- Knowledge base: each intent has keywords + an answer ----
  const KB = [
    {
      keys: ["rate", "price", "cost", "how much", "fee", "charge", "quote"],
      answer: "Our shipping rates start at:<br>• Ocean freight - <b>$7.50</b> / cu ft (consolidated)<br>• Air freight - <b>$4.25</b> / lb (2–3 days)<br>• Package consolidation - <b>$5.00</b><br>Customs duty &amp; VAT are calculated at checkout. Want a personalized quote? Visit our <a href='/contact/'>Contact page</a>."
    },
    {
      keys: ["track", "where is", "package status", "tracking number", "parcel"],
      answer: "You can track any shipment on our <a href='/tracking/'>Track Package</a> page - just enter your tracking number. You can also track right from the card on our homepage."
    },
    {
      keys: ["customs", "vat", "duty", "tax", "clearance", "invoice"],
      answer: "GOFA handles customs for you. Upload your invoice when you ship and we'll process customs, VAT, and duty with <b>priority clearance</b> for Business members. You'll get a clear quote before anything is charged."
    },
    {
      keys: ["member", "membership", "plan", "upgrade", "subscription", "tier"],
      answer: "We offer 4 plans:<br>• <b>Basic</b> - Free (standard rates, tracking, email support)<br>• <b>GOFA Plus</b> - $19.99/mo (lower rates, priority updates, free invoice review)<br>• <b>GOFA Business</b> - $49.99/mo (bulk discounts, priority customs, dedicated support)<br>• <b>Family Island</b> - $29.99/mo (boat drop-off, island delivery, consolidation)<br>See <a href='/#membership'>all plans</a>."
    },
    {
      keys: ["family island", "island", "boat", "out island", "delivery"],
      answer: "Our <b>Family Island Plan</b> ($29.99/mo) includes boat drop-off service, island delivery coordination, package consolidation, and regular updates - getting your goods all the way home."
    },
    {
      keys: ["hour", "open", "time", "when are you"],
      answer: "We're open <b>Monday–Friday, 8:00 AM – 5:00 PM</b> and <b>Saturday, 9:00 AM – 12:00 PM</b> (half day). You can reach us anytime by email and we usually reply within one business day."
    },
    {
      keys: ["contact", "phone", "call", "email", "reach", "number", "address", "location"],
      answer: "You can reach GOFA Shipping at:<br>📞 <a href='tel:+12424275699'>(242) 427-5699</a><br>✉️ <a href='mailto:info@gofashipping.com'>info@gofashipping.com</a><br>📍 Nassau, The Bahamas"
    },
    {
      keys: ["account", "sign up", "register", "log in", "login", "create account"],
      answer: "You can create a free account or log in on our <a href='/account/'>Account page</a>. Signing up gives you a U.S. shipping address, tracking, and faster quotes."
    },
    {
      keys: ["how it works", "how do i", "get started", "start", "steps", "ship to"],
      answer: "It's 4 simple steps:<br>1. Create your free account &amp; get a U.S. address<br>2. Shop and ship to that address, upload your invoice<br>3. We handle customs &amp; give you a fast quote<br>4. Pick up in Nassau or get Family Island delivery<br>More on <a href='/#how'>How It Works</a>."
    },
    {
      keys: ["hello", "hi", "hey", "good morning", "good afternoon", "yo"],
      answer: "Hey there! 👋 I'm the GOFA assistant. Ask me about rates, tracking, customs, membership plans, or how to get started."
    },
    {
      keys: ["thanks", "thank you", "appreciate", "cheers"],
      answer: "You're welcome! Anything else I can help you ship? 🚢"
    }
  ];

  const FALLBACK = "I'm not sure about that one, but our team can help! Reach us at <a href='tel:+12424275699'>(242) 427-5699</a> or <a href='mailto:info@gofashipping.com'>info@gofashipping.com</a>, or try asking about <b>rates</b>, <b>tracking</b>, <b>customs</b>, or <b>membership</b>.";

  const CHIPS = ["Shipping rates", "Track a package", "Membership plans", "How it works"];

  function findAnswer(text) {
    const t = text.toLowerCase();
    let best = null, bestScore = 0;
    for (const item of KB) {
      let score = 0;
      for (const k of item.keys) if (t.includes(k)) score += k.length;
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return best ? best.answer : FALLBACK;
  }

  // ---- Build widget DOM ----
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function build() {
    const root = el("div", "gofa-chat");
    root.innerHTML = `
      <button class="gofa-chat-fab" aria-label="Chat with GOFA assistant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="gofa-chat-badge">1</span>
      </button>
      <div class="gofa-chat-panel" hidden>
        <div class="gofa-chat-head">
          <div class="gofa-chat-avatar">🤖</div>
          <div>
            <strong>GOFA Assistant</strong>
            <small>Typically replies instantly</small>
          </div>
          <button class="gofa-chat-close" aria-label="Close chat">&times;</button>
        </div>
        <div class="gofa-chat-body" id="gofaChatBody"></div>
        <div class="gofa-chat-chips" id="gofaChatChips"></div>
        <form class="gofa-chat-input" id="gofaChatForm">
          <input type="text" id="gofaChatText" placeholder="Ask about rates, tracking, customs…" autocomplete="off" />
          <button type="submit" aria-label="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </button>
        </form>
      </div>`;
    document.body.appendChild(root);

    const fab = root.querySelector(".gofa-chat-fab");
    const panel = root.querySelector(".gofa-chat-panel");
    const closeBtn = root.querySelector(".gofa-chat-close");
    const body = root.querySelector("#gofaChatBody");
    const chips = root.querySelector("#gofaChatChips");
    const form = root.querySelector("#gofaChatForm");
    const input = root.querySelector("#gofaChatText");
    const badge = root.querySelector(".gofa-chat-badge");
    let greeted = false;

    function addMsg(html, who) {
      const m = el("div", "gofa-msg " + who, html);
      body.appendChild(m);
      body.scrollTop = body.scrollHeight;
      return m;
    }

    function botReply(text) {
      const typing = addMsg("<span class='gofa-typing'><i></i><i></i><i></i></span>", "bot");
      setTimeout(() => {
        typing.innerHTML = findAnswer(text);
        body.scrollTop = body.scrollHeight;
      }, 500);
    }

    function renderChips() {
      chips.innerHTML = "";
      CHIPS.forEach(c => {
        const b = el("button", "gofa-chip", c);
        b.addEventListener("click", () => { handle(c); });
        chips.appendChild(b);
      });
    }

    function handle(text) {
      addMsg(text.replace(/</g, "&lt;"), "user");
      botReply(text);
    }

    function openPanel() {
      panel.hidden = false;
      fab.classList.add("open");
      badge.style.display = "none";
      input.focus();
      if (!greeted) {
        greeted = true;
        addMsg("👋 Hi! I'm the GOFA Shipping assistant. How can I help you today?", "bot");
        renderChips();
      }
    }
    function closePanel() { panel.hidden = true; fab.classList.remove("open"); }

    fab.addEventListener("click", () => panel.hidden ? openPanel() : closePanel());
    closeBtn.addEventListener("click", closePanel);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = "";
      handle(v);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();

/* GOFA SHIPPING - navy shine sweep on scroll
 * Adds a diagonal light sweep across navy sections each time they scroll into view.
 */
(function () {
  function setup() {
    const els = document.querySelectorAll(".membership, .cta-band, .site-footer, .contact-hero, .account-hero, .track-hero, .trust");
    els.forEach(e => e.classList.add("nav-shine"));
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting) {
          ent.target.classList.add("shine-go");
          setTimeout(() => ent.target.classList.remove("shine-go"), 1200);
        }
      });
    }, { threshold: 0.35 });
    els.forEach(e => io.observe(e));
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
