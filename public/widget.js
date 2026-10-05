(function () {
  "use strict";

  if (window.__workwiseWidgetLoaded) return;
  window.__workwiseWidgetLoaded = true;

  var BASE_URL = "https://app.joinworkwise.com";
  var clientId = null;

  function widgetScript() {
    if (document.currentScript && document.currentScript.src) return document.currentScript;
    var scripts = document.getElementsByTagName("script");
    var i;
    for (i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && scripts[i].src.indexOf("widget.js") !== -1) return scripts[i];
    }
    return null;
  }

  var tag = widgetScript();
  if (tag && tag.src) {
    try {
      var parsed = new URL(tag.src);
      if (parsed.origin) BASE_URL = parsed.origin;
      clientId = parsed.searchParams.get("id");
    } catch (err) {
      clientId = null;
    }
  }
  if (!clientId) return;

  var state = {
    conversationId: "",
    session: "",
    mode: "enquiry",
    businessName: "",
    greeting: "",
  };

  var greeted = false;
  var sendingChat = false;
  var limited = false;
  var detailsOpen = false;
  var leadSending = false;
  var leadDone = false;

  var launcher;
  var chatWindow;
  var messagesEl;
  var composer;
  var composerInput;
  var sendBtn;
  var detailsEl;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function svgEl(name) {
    return document.createElementNS("http://www.w3.org/2000/svg", name);
  }

  function iconSvg(size, strokeWidth) {
    var svg = svgEl("svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", strokeWidth);
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }

  function chatIcon() {
    var svg = iconSvg(24, "2");
    var path = svgEl("path");
    path.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
    svg.appendChild(path);
    return svg;
  }

  function closeIcon() {
    var svg = iconSvg(16, "2.5");
    var a = svgEl("line");
    a.setAttribute("x1", "18");
    a.setAttribute("y1", "6");
    a.setAttribute("x2", "6");
    a.setAttribute("y2", "18");
    var b = svgEl("line");
    b.setAttribute("x1", "6");
    b.setAttribute("y1", "6");
    b.setAttribute("x2", "18");
    b.setAttribute("y2", "18");
    svg.appendChild(a);
    svg.appendChild(b);
    return svg;
  }

  function sendIcon() {
    var svg = iconSvg(16, "2.5");
    var line = svgEl("line");
    line.setAttribute("x1", "22");
    line.setAttribute("y1", "2");
    line.setAttribute("x2", "11");
    line.setAttribute("y2", "13");
    var polygon = svgEl("polygon");
    polygon.setAttribute("points", "22 2 15 22 11 13 2 9 22 2");
    svg.appendChild(line);
    svg.appendChild(polygon);
    return svg;
  }

  function safeColour(value) {
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
    return "#0C66E4";
  }

  function validMobile(value) {
    var compact = String(value).replace(/\s/g, "");
    return /^(\+44\s?7|07)\d{3}\s?\d{6}$/.test(compact);
  }

  function validPostcode(value) {
    return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(String(value).trim());
  }

  function styles(colour) {
    return (
      ".ww-button{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:" +
      colour +
      ";border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.18);z-index:2147483647;transition:transform 0.2s ease,box-shadow 0.2s ease;padding:0;margin:0}" +
      ".ww-button:hover{transform:scale(1.08);box-shadow:0 8px 32px rgba(0,0,0,0.22)}" +
      ".ww-button svg{width:24px;height:24px;display:block}" +
      ".ww-window{position:fixed;bottom:96px;right:24px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 8px 48px rgba(0,0,0,0.18);display:flex;flex-direction:column;overflow:hidden;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:left;line-height:1.4;color:#0A1A2E;visibility:visible;transition:opacity 0.2s ease,transform 0.2s ease,visibility 0s linear 0s}" +
      ".ww-hidden{opacity:0;pointer-events:none;transform:translateY(12px);visibility:hidden;transition:opacity 0.2s ease,transform 0.2s ease,visibility 0s linear 0.2s}" +
      ".ww-gone{display:none !important}" +
      ".ww-header{background:#0A1A2E;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}" +
      ".ww-header-info{display:flex;align-items:center;gap:10px;min-width:0}" +
      ".ww-online-dot{width:8px;height:8px;border-radius:50%;background:#22C55E;flex-shrink:0;animation:ww-pulse 2s infinite}" +
      "@keyframes ww-pulse{0%,100%{opacity:1}50%{opacity:0.4}}" +
      ".ww-business-name{font-size:14px;font-weight:600;color:#fff;line-height:1.2;word-break:break-word}" +
      ".ww-powered-by{font-size:11px;color:rgba(255,255,255,0.5);margin-top:1px}" +
      ".ww-powered-link{color:rgba(255,255,255,0.5);text-decoration:none}" +
      ".ww-powered-link:hover{color:rgba(255,255,255,0.8)}" +
      ".ww-close{background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.6);padding:4px;display:flex;align-items:center;justify-content:center;border-radius:4px;margin:0}" +
      ".ww-close:hover{color:#fff}" +
      ".ww-close svg,.ww-send svg{width:16px;height:16px;display:block}" +
      ".ww-messages{flex:1 1 auto;min-height:72px;overflow-y:auto;overflow-x:hidden;padding:16px;display:flex;flex-direction:column;gap:10px;background:#FAFAF8}" +
      ".ww-msg{max-width:82%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}" +
      ".ww-msg-bot{background:#fff;color:#0A1A2E;border-radius:16px 16px 16px 4px;align-self:flex-start;box-shadow:0 1px 4px rgba(0,0,0,0.08)}" +
      ".ww-msg-user{background:" +
      colour +
      ";color:#fff;border-radius:16px 16px 4px 16px;align-self:flex-end}" +
      ".ww-typing{display:flex;gap:4px;align-items:center;padding:12px 14px;background:#fff;border-radius:16px 16px 16px 4px;align-self:flex-start;box-shadow:0 1px 4px rgba(0,0,0,0.08)}" +
      ".ww-typing span{width:6px;height:6px;border-radius:50%;background:#B8B6B0;animation:ww-bounce 1.2s infinite}" +
      ".ww-typing span:nth-child(2){animation-delay:0.2s}" +
      ".ww-typing span:nth-child(3){animation-delay:0.4s}" +
      "@keyframes ww-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}" +
      ".ww-card{align-self:flex-start;max-width:92%;background:#fff;border:1px solid #EBEBEA;border-radius:16px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.08)}" +
      ".ww-card-price{font-size:22px;font-weight:700;color:#0A1A2E;line-height:1.2;word-break:break-word}" +
      ".ww-card-summary{font-size:14px;margin-top:4px;color:#0A1A2E;word-break:break-word}" +
      ".ww-card-note{font-size:12px;color:#6B6964;margin-top:6px;word-break:break-word}" +
      ".ww-messages>.ww-card-actions{align-self:flex-start}" +
      ".ww-card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}" +
      ".ww-book,.ww-ask,.ww-leave,.ww-submit,.ww-cancel{font-family:inherit;font-size:13px;line-height:1.2;cursor:pointer;border-radius:999px;margin:0;width:auto;max-width:100%;box-sizing:border-box}" +
      ".ww-book,.ww-submit{background:" +
      colour +
      ";color:#fff;border:none;padding:8px 14px}" +
      ".ww-ask,.ww-leave,.ww-cancel{background:#fff;color:#0A1A2E;border:1px solid #EBEBEA;padding:8px 12px}" +
      ".ww-book:disabled,.ww-submit:disabled,.ww-send:disabled,.ww-cancel:disabled{opacity:0.4;cursor:not-allowed}" +
      ".ww-composer{display:flex;align-items:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #EBEBEA;background:#fff;flex-shrink:0}" +
      ".ww-input{flex:1;border:1px solid #EBEBEA;border-radius:24px;padding:10px 16px;font-size:14px;line-height:1.4;outline:none;background:#FAFAF8;color:#0A1A2E;font-family:inherit;resize:none;max-height:96px;min-width:0;box-sizing:border-box;margin:0}" +
      ".ww-input:focus{border-color:" +
      colour +
      "}" +
      ".ww-send{width:36px;height:36px;border-radius:50%;background:" +
      colour +
      ";border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;padding:0;margin:0}" +
      ".ww-send:hover{opacity:0.85}" +
      ".ww-form-open{height:auto;max-height:calc(100vh - 24px);bottom:12px}" +
      ".ww-form-open .ww-messages{display:none !important}" +
      ".ww-form-open .ww-details{flex:1 1 auto;min-height:0;overflow-y:auto}" +
      ".ww-details{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;background:#fff;display:flex;flex-direction:column}" +
      ".ww-details-form{display:flex;flex-direction:column;gap:8px;padding:14px 16px 12px;box-sizing:border-box}" +
      ".ww-details-title{font-size:18px;font-weight:650;margin:0;color:#0A1A2E}" +
      ".ww-details-lead{margin:0;font-size:13px;line-height:1.45;color:#6B6964}" +
      ".ww-field{display:flex;flex-direction:column;gap:4px;min-width:0}" +
      ".ww-label{font-size:12px;font-weight:600;color:#0A1A2E}" +
      ".ww-field-input,.ww-note{width:100%;max-width:100%;box-sizing:border-box;border:1px solid #EBEBEA;border-radius:10px;padding:8px 10px;font-size:14px;font-family:inherit;color:#0A1A2E;background:#FAFAF8;margin:0}" +
      ".ww-field-input:focus,.ww-note:focus{outline:none;border-color:" +
      colour +
      "}" +
      ".ww-note{resize:none;height:40px;min-height:40px}" +
      ".ww-field-error,.ww-form-error{font-size:12px;color:#B42318;word-break:break-word}" +
      ".ww-field-error:empty,.ww-form-error:empty{display:none}" +
      ".ww-counter{font-size:11px;color:#6B6964;text-align:right}" +
      ".ww-consent{font-size:12px;color:#6B6964;margin:0;word-break:break-word}" +
      ".ww-details .ww-submit{display:block;width:100%;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:600}" +
      ".ww-details .ww-cancel{display:block;width:100%;border:none;background:transparent;color:#6B6964;padding:8px 12px;font-size:13px}" +
      ".ww-details-actions{display:flex;flex-direction:column;gap:2px;margin-top:4px}" +
      "@media (max-width:480px){.ww-window{bottom:0;right:0;left:0;width:100%;max-width:100%;height:75vh;border-radius:16px 16px 0 0}.ww-button{bottom:16px;right:16px}}"
    );
  }

  function scrollMessages() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBotMessage(text) {
    var msg = el("div", "ww-msg ww-msg-bot", text);
    messagesEl.appendChild(msg);
    scrollMessages();
    return msg;
  }

  function addUserMessage(text) {
    var msg = el("div", "ww-msg ww-msg-user", text);
    messagesEl.appendChild(msg);
    scrollMessages();
    return msg;
  }

  function showTyping() {
    hideTyping();
    var typing = el("div", "ww-typing");
    typing.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(typing);
    scrollMessages();
  }

  function hideTyping() {
    var typing = messagesEl.querySelector(".ww-typing");
    if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
  }

  function dropNode(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function readJson(res) {
    return res.json().then(
      function (data) {
        return { status: res.status, data: data };
      },
      function () {
        return { status: res.status, data: null };
      },
    );
  }

  function loadConfig() {
    return fetch(BASE_URL + "/api/widget/" + encodeURIComponent(clientId) + "/config", {
      method: "GET",
      credentials: "omit",
    }).then(
      function (res) {
        if (res.status !== 200) return null;
        return res.json().then(
          function (data) {
            return data;
          },
          function () {
            return null;
          },
        );
      },
      function () {
        return null;
      },
    );
  }

  function applySession(config) {
    if (!config || config.active !== true) return false;
    if (typeof config.conversationId !== "string" || !config.conversationId) return false;
    if (typeof config.session !== "string" || !config.session) return false;
    state.conversationId = config.conversationId;
    state.session = config.session;
    return true;
  }

  function applyConfig(config) {
    if (!applySession(config)) return false;
    state.businessName = typeof config.businessName === "string" ? config.businessName : "";
    state.greeting = typeof config.greeting === "string" ? config.greeting : "";
    state.mode = config.mode === "quote" ? "quote" : "enquiry";
    return true;
  }

  function lockLimited() {
    limited = true;
    sendingChat = false;
    composerInput.disabled = true;
    sendBtn.disabled = true;
  }

  function unlockComposer(delayMs) {
    var run = function () {
      sendingChat = false;
      if (limited) {
        composerInput.disabled = true;
        sendBtn.disabled = true;
        return;
      }
      composerInput.disabled = false;
      sendBtn.disabled = false;
      if (!detailsOpen && !chatWindow.classList.contains("ww-hidden")) composerInput.focus();
    };
    if (delayMs) setTimeout(run, delayMs);
    else run();
  }

  function openPanel() {
    launcher.classList.add("ww-gone");
    chatWindow.classList.remove("ww-hidden");
    if (!greeted) {
      greeted = true;
      if (state.greeting) addBotMessage(state.greeting);
    }
    if (!detailsOpen && !limited && !sendingChat) composerInput.focus();
  }

  function closePanel() {
    chatWindow.classList.add("ww-hidden");
    launcher.classList.remove("ww-gone");
  }

  function addEnquiryButton() {
    var row = el("div", "ww-card-actions");
    var btn = el("button", "ww-leave", "Leave my details");
    btn.type = "button";
    btn.addEventListener("click", function () {
      openDetails();
    });
    row.appendChild(btn);
    messagesEl.appendChild(row);
    scrollMessages();
  }

  function hideBookingButtons() {
    var nodes = chatWindow.querySelectorAll(".ww-book, .ww-leave");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var parent = node.parentNode;
      if (parent) parent.removeChild(node);
      if (
        parent &&
        parent.classList &&
        parent.classList.contains("ww-card-actions") &&
        !parent.querySelector(".ww-ask, .ww-book, .ww-leave")
      ) {
        if (parent.parentNode) parent.parentNode.removeChild(parent);
      }
    }
  }

  function handleAnswer(data) {
    if (!data || typeof data !== "object") {
      addBotMessage("Sorry, something went wrong — please try again.");
      return;
    }
    if (typeof data.reply === "string" && data.reply) addBotMessage(data.reply);
    if (data.askForDetails === true && data.outOfArea !== true && !leadDone) addEnquiryButton();
  }

  function sendChat() {
    if (sendingChat || limited || detailsOpen) return;
    var text = composerInput.value.trim();
    if (!text) return;
    sendingChat = true;
    composerInput.disabled = true;
    sendBtn.disabled = true;
    composerInput.value = "";
    var pending = addUserMessage(text);
    showTyping();

    fetch(BASE_URL + "/api/widget/chat", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: clientId,
        conversationId: state.conversationId,
        session: state.session,
        message: text,
      }),
    }).then(readJson, function () {
      return null;
    }).then(function (result) {
      hideTyping();
      if (!result) {
        dropNode(pending);
        composerInput.value = text;
        addBotMessage("Sorry, something went wrong — please try again.");
        unlockComposer(0);
        return;
      }
      if (result.status === 200) {
        handleAnswer(result.data);
        unlockComposer(0);
        return;
      }
      if (result.status === 429) {
        var limitedMessage =
          result.data && typeof result.data.message === "string"
            ? result.data.message
            : "Sorry, I can't take more messages right now — please try again later.";
        addBotMessage(limitedMessage);
        lockLimited();
        return;
      }
      dropNode(pending);
      composerInput.value = text;
      if (result.status === 401) {
        loadConfig().then(function (config) {
          if (!applySession(config)) addBotMessage("Sorry, something went wrong — please try again.");
          else addBotMessage("Sorry, that chat timed out — let's start again.");
          unlockComposer(0);
        });
        return;
      }
      if (result.status === 409) {
        addBotMessage("One moment — I'm still answering your last message.");
        unlockComposer(2000);
        return;
      }
      addBotMessage("Sorry, something went wrong — please try again.");
      unlockComposer(0);
    });
  }

  function closeDetails() {
    detailsOpen = false;
    leadSending = false;
    while (detailsEl.firstChild) detailsEl.removeChild(detailsEl.firstChild);
    detailsEl.classList.add("ww-gone");
    chatWindow.classList.remove("ww-form-open");
    composer.classList.remove("ww-gone");
    if (limited) {
      composerInput.disabled = true;
      sendBtn.disabled = true;
      return;
    }
    if (!sendingChat) {
      composerInput.disabled = false;
      sendBtn.disabled = false;
      if (!chatWindow.classList.contains("ww-hidden")) composerInput.focus();
    }
  }

  function labelledInput(id, labelText, type, maxLength, autocomplete, required) {
    var wrap = el("div", "ww-field");
    var label = el("label", "ww-label", labelText);
    label.htmlFor = id;
    var input = document.createElement("input");
    input.className = "ww-field-input";
    input.id = id;
    input.type = type;
    input.maxLength = maxLength;
    input.autocomplete = autocomplete;
    if (required) input.setAttribute("aria-required", "true");
    var error = el("div", "ww-field-error");
    error.id = id + "-error";
    input.setAttribute("aria-describedby", error.id);
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(error);
    return { wrap: wrap, input: input, error: error };
  }

  function finishLead(name) {
    var first = name.trim().split(/\s+/)[0];
    closeDetails();
    leadDone = true;
    hideBookingButtons();
    addBotMessage("Thanks " + first + " — " + state.businessName + " will be in touch shortly.");
  }

  function openDetails() {
    if (detailsOpen || leadDone || leadSending) return;
    detailsOpen = true;
    while (detailsEl.firstChild) detailsEl.removeChild(detailsEl.firstChild);

    var title = "Your details";

    var form = el("form", "ww-details-form");
    form.noValidate = true;
    form.appendChild(el("h2", "ww-details-title", title));
    form.appendChild(
      el(
        "p",
        "ww-details-lead",
        "Nothing is booked. " + state.businessName + " will get in touch about it.",
      ),
    );

    var name = labelledInput("ww-lead-name", "Name", "text", 80, "name", true);
    var mobile = labelledInput("ww-lead-mobile", "Mobile", "tel", 20, "tel", true);
    var postcode = labelledInput("ww-lead-postcode", "Postcode", "text", 9, "postal-code", true);
    var email = labelledInput("ww-lead-email", "Email, if you like", "email", 200, "email", false);
    form.appendChild(name.wrap);
    form.appendChild(mobile.wrap);
    form.appendChild(postcode.wrap);
    form.appendChild(email.wrap);

    var noteWrap = el("div", "ww-field");
    var noteLabel = el("label", "ww-label", "Anything else?");
    noteLabel.htmlFor = "ww-lead-note";
    var note = document.createElement("textarea");
    note.className = "ww-note";
    note.id = "ww-lead-note";
    note.maxLength = 120;
    var counter = el("div", "ww-counter", "0/120");
    var noteError = el("div", "ww-field-error");
    noteError.id = "ww-lead-note-error";
    note.setAttribute("aria-describedby", noteError.id);
    note.addEventListener("input", function () {
      counter.textContent = String(note.value.length) + "/120";
    });
    noteWrap.appendChild(noteLabel);
    noteWrap.appendChild(note);
    noteWrap.appendChild(counter);
    noteWrap.appendChild(noteError);
    form.appendChild(noteWrap);

    form.appendChild(
      el(
        "p",
        "ww-consent",
        "We'll text you shortly. By sending you agree to " +
          state.businessName +
          " contacting you about this job.",
      ),
    );

    var formError = el("div", "ww-form-error");
    form.appendChild(formError);

    var actions = el("div", "ww-details-actions");
    var submit = el("button", "ww-submit", "Send");
    submit.type = "submit";
    var cancel = el("button", "ww-cancel", "Cancel");
    cancel.type = "button";
    actions.appendChild(submit);
    actions.appendChild(cancel);
    form.appendChild(actions);

    var errors = {
      name: name.error,
      mobile: mobile.error,
      postcode: postcode.error,
      email: email.error,
      note: noteError,
    };

    function clearErrors() {
      var key;
      for (key in errors) {
        if (Object.prototype.hasOwnProperty.call(errors, key)) errors[key].textContent = "";
      }
      formError.textContent = "";
    }

    cancel.addEventListener("click", function () {
      if (leadSending) return;
      closeDetails();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (leadSending) return;
      clearErrors();
      var nameValue = name.input.value.trim();
      var mobileValue = mobile.input.value.trim();
      var postcodeValue = postcode.input.value.trim();
      var emailValue = email.input.value.trim();
      var noteValue = note.value.trim();
      if (noteValue.length > 120) noteValue = noteValue.slice(0, 120);
      var valid = true;
      if (nameValue.length < 1 || nameValue.length > 80) {
        name.error.textContent = "Please enter your name.";
        valid = false;
      }
      if (!validMobile(mobileValue)) {
        mobile.error.textContent = "Please enter a UK mobile number.";
        valid = false;
      }
      if (!validPostcode(postcodeValue)) {
        postcode.error.textContent = "Please check your postcode.";
        valid = false;
      }
      if (!valid) {
        if (nameValue.length < 1 || nameValue.length > 80) name.input.focus();
        else if (!validMobile(mobileValue)) mobile.input.focus();
        else postcode.input.focus();
        return;
      }

      leadSending = true;
      submit.disabled = true;
      cancel.disabled = true;

      fetch(BASE_URL + "/api/widget/lead", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId,
          conversationId: state.conversationId,
          session: state.session,
          name: nameValue,
          mobile: mobileValue,
          postcode: postcodeValue,
          email: emailValue,
          preferredDays: [],
          note: noteValue,
          wantsBooking: false,
        }),
      }).then(readJson, function () {
        return null;
      }).then(function (result) {
        if (!detailsOpen) return;
        if (
          result &&
          (result.status === 200 ||
            (result.status === 409 && result.data && result.data.duplicate === true))
        ) {
          finishLead(nameValue);
          return;
        }
        leadSending = false;
        submit.disabled = false;
        cancel.disabled = false;
        var fieldName = result && result.data ? result.data.field : "";
        if (
          result &&
          result.status === 400 &&
          (fieldName === "name" ||
            fieldName === "mobile" ||
            fieldName === "postcode" ||
            fieldName === "email" ||
            fieldName === "note")
        ) {
          errors[fieldName].textContent =
            typeof result.data.message === "string" && result.data.message
              ? result.data.message
              : "Please check this.";
          return;
        }
        formError.textContent = "Sorry, that didn't send — please try again.";
      });
    });

    detailsEl.appendChild(form);
    chatWindow.classList.add("ww-form-open");
    composer.classList.add("ww-gone");
    detailsEl.classList.remove("ww-gone");
    detailsEl.scrollTop = 0;
    name.input.focus();
  }

  function mount(colour) {
    var style = document.createElement("style");
    style.textContent = styles(colour);
    document.head.appendChild(style);

    launcher = el("button", "ww-button");
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Open quote chat");
    launcher.appendChild(chatIcon());
    document.body.appendChild(launcher);

    chatWindow = el("div", "ww-window ww-hidden");
    var header = el("div", "ww-header");
    var info = el("div", "ww-header-info");
    info.appendChild(el("div", "ww-online-dot"));
    var titles = el("div");
    titles.appendChild(el("div", "ww-business-name", state.businessName));
    var powered = el("div", "ww-powered-by", "Powered by ");
    var link = el("a", "ww-powered-link", "WorkWise");
    link.setAttribute("href", "https://joinworkwise.com");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    powered.appendChild(link);
    titles.appendChild(powered);
    info.appendChild(titles);
    header.appendChild(info);
    var closeBtn = el("button", "ww-close");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.appendChild(closeIcon());
    header.appendChild(closeBtn);
    chatWindow.appendChild(header);

    messagesEl = el("div", "ww-messages");
    messagesEl.setAttribute("aria-live", "polite");
    chatWindow.appendChild(messagesEl);

    composer = el("div", "ww-composer");
    composerInput = document.createElement("textarea");
    composerInput.className = "ww-input";
    composerInput.setAttribute("placeholder", "Type a message...");
    composerInput.setAttribute("autocomplete", "off");
    composerInput.setAttribute("rows", "1");
    composerInput.maxLength = 1000;
    composerInput.setAttribute("aria-label", "Message");
    sendBtn = el("button", "ww-send");
    sendBtn.type = "button";
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtn.appendChild(sendIcon());
    composer.appendChild(composerInput);
    composer.appendChild(sendBtn);
    chatWindow.appendChild(composer);

    detailsEl = el("div", "ww-details ww-gone");
    chatWindow.appendChild(detailsEl);
    document.body.appendChild(chatWindow);

    launcher.addEventListener("click", openPanel);
    closeBtn.addEventListener("click", closePanel);
    sendBtn.addEventListener("click", sendChat);
    composerInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChat();
      }
    });
    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key !== "Escape") return;
        if (chatWindow.classList.contains("ww-hidden")) return;
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      },
      true,
    );
  }

  function init() {
    if (!document.body) return;
    loadConfig().then(function (config) {
      if (!config || config.active !== true) return;
      if (!applyConfig(config)) return;
      try {
        mount(safeColour(config.primaryColour));
      } catch (err) {
        // Never break the host page.
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
