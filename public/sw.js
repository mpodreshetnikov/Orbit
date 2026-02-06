// Service Worker for PWA functionality

// ---------------------------------------------------------------------------
// App language: read from Cache API (written by app from localStorage), fallback to navigator
// ---------------------------------------------------------------------------
var SW_LOCALE_CACHE_NAME = "app-prefs";
var SW_LOCALE_CACHE_KEY = "/app-locale";

function getDeviceLangSync() {
  try {
    var lang = (self.navigator && self.navigator.language) ? self.navigator.language.split("-")[0] : "en";
    return lang === "ru" ? "ru" : "en";
  } catch (_) {
    return "en";
  }
}

function getAppLang() {
  try {
    if (!self.caches || !self.caches.open) return Promise.resolve(getDeviceLangSync());
    return self.caches.open(SW_LOCALE_CACHE_NAME).then(function (cache) {
      return cache.match(SW_LOCALE_CACHE_KEY);
    }).then(function (response) {
      if (response) return response.text();
      return null;
    }).then(function (lang) {
      if (lang === "ru" || lang === "en") return lang;
      return getDeviceLangSync();
    }).catch(function () {
      return getDeviceLangSync();
    });
  } catch (_) {
    return Promise.resolve(getDeviceLangSync());
  }
}

// ---------------------------------------------------------------------------
// Default assets
// ---------------------------------------------------------------------------
var DEFAULT_ICON = "/icons/icon-192x192.png";

// ---------------------------------------------------------------------------
// Title prefix helpers
// ---------------------------------------------------------------------------
function resolveTitlePrefix(n) {
  if (!n) return null;
  if (Object.prototype.hasOwnProperty.call(n, "title_prefix")) {
    return n.title_prefix || null;
  }
  if (Object.prototype.hasOwnProperty.call(n, "titlePrefix")) {
    return n.titlePrefix || null;
  }
  return n.person_name || n.personName || null;
}

function applyTitlePrefix(title, prefix) {
  if (!prefix) return title;
  var prefixLabel = String(prefix).trim();
  if (!prefixLabel) return title;
  var prefixText = "(" + prefixLabel + ") ";
  return title.startsWith(prefixText) ? title : (prefixText + title);
}

// ---------------------------------------------------------------------------
// Notification type handlers
// Add a new type by adding an entry to NOTIFICATION_TYPE_HANDLERS.
// Each handler can define: icon, badge, image, getActions(lang), getTitle(n, lang), getBody(n, lang), getData(n), onActionClick(event, data, action).
// ---------------------------------------------------------------------------

// Plural category for unit labels (CLDR-style: en one/other; ru one/few/many/other).
function getPluralCategory(lang, count) {
  var n = Math.abs(parseInt(count, 10)) || 0;
  if (lang === "ru") {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
    if (mod10 === 0 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 11 && mod100 <= 14)) return "many";
    return "other";
  }
  return n === 1 ? "one" : "other";
}

var UNIT_LABELS = {
  en: {
    pill: { one: "pill", other: "pills" },
    capsule: { one: "capsule", other: "capsules" },
    ml: { one: "ml", other: "ml" },
    drops: { one: "drops", other: "drops" },
    milligram: { one: "mg", other: "mg" },
    gram: { one: "g", other: "g" },
    iu: { one: "IU", other: "IU" },
    ampoule: { one: "ampoule", other: "ampoules" },
    injection: { one: "injection", other: "injections" },
    inhalation: { one: "inhalation", other: "inhalations" },
    patch: { one: "patch", other: "patches" },
    application: { one: "application", other: "applications" },
    spray: { one: "spray", other: "sprays" },
    portion: { one: "portion", other: "portions" },
    tablespoon: { one: "tablespoon", other: "tablespoons" },
    teaspoon: { one: "teaspoon", other: "teaspoons" },
    unit: { one: "unit", other: "units" },
    suppository: { one: "suppository", other: "suppositories" },
    other: { one: "other", other: "other" },
  },
  ru: {
    pill: { one: "таблетка", few: "таблетки", many: "таблеток", other: "таблеток" },
    capsule: { one: "капсула", few: "капсулы", many: "капсул", other: "капсул" },
    ml: { one: "мл", few: "мл", many: "мл", other: "мл" },
    drops: { one: "капля", few: "капли", many: "капель", other: "капель" },
    milligram: { one: "мг", few: "мг", many: "мг", other: "мг" },
    gram: { one: "г", few: "г", many: "г", other: "г" },
    iu: { one: "МЕ", few: "МЕ", many: "МЕ", other: "МЕ" },
    ampoule: { one: "ампула", few: "ампулы", many: "ампул", other: "ампул" },
    injection: { one: "инъекция", few: "инъекции", many: "инъекций", other: "инъекций" },
    inhalation: { one: "ингаляция", few: "ингаляции", many: "ингаляций", other: "ингаляций" },
    patch: { one: "пластырь", few: "пластыря", many: "пластырей", other: "пластырей" },
    application: { one: "нанесение", few: "нанесения", many: "нанесений", other: "нанесений" },
    spray: { one: "впрыскивание", few: "впрыскивания", many: "впрыскиваний", other: "впрыскиваний" },
    portion: { one: "порция", few: "порции", many: "порций", other: "порций" },
    tablespoon: { one: "ст. ложка", few: "ст. ложки", many: "ст. ложек", other: "ст. ложек" },
    teaspoon: { one: "ч. ложка", few: "ч. ложки", many: "ч. ложек", other: "ч. ложек" },
    unit: { one: "единица", few: "единицы", many: "единиц", other: "единиц" },
    suppository: { one: "свеча", few: "свечи", many: "свечей", other: "свечей" },
    other: { one: "другое", few: "другое", many: "другое", other: "другое" },
  },
};

function translateUnit(unitKey, lang, count) {
  if (!unitKey || typeof unitKey !== "string") return translateUnit("pill", lang, count);
  var key = unitKey.toLowerCase();
  var langMap = UNIT_LABELS[lang] || UNIT_LABELS.en;
  var forms = langMap[key] || UNIT_LABELS.en[key];
  if (!forms || typeof forms !== "object") return key;
  var category = getPluralCategory(lang, count);
  return forms[category] != null ? forms[category] : forms.other;
}

var MEDICATION_TITLES = { en: "Medications", ru: "Лекарства" };
var MEDICATION_ACTION_LABELS = { en: { confirm: "Confirm", skip: "Skip" }, ru: { confirm: "Подтвердить", skip: "Пропустить" } };

function getMedicationTitle(n, lang) {
  return MEDICATION_TITLES[lang] || MEDICATION_TITLES.en;
}

function getMedicationActionLabels(lang) {
  return MEDICATION_ACTION_LABELS[lang] || MEDICATION_ACTION_LABELS.en;
}

function getMedicationBody(n, lang) {
  if (n.medicationName == null || n.amount == null) return n.body;
  var amount = parseInt(n.amount, 10) || 0;
  var unitLabel = translateUnit(n.unit, lang, amount);
  return n.medicationName + " — " + n.amount + " " + unitLabel;
}

function getMedicationData(n) {
  var doseEventIds = Array.isArray(n.dose_event_ids)
    ? n.dose_event_ids
    : n.dose_event_id != null ? [n.dose_event_id] : [];
  return { dose_event_ids: doseEventIds };
}

/** Resolves a type handler for a given notification type. Multiple types can share one handler. */
function getTypeHandler(type) {
  if (type === "medication" || type === "medication_snoozed") {
    return NOTIFICATION_TYPE_HANDLERS.medication;
  }
  return NOTIFICATION_TYPE_HANDLERS[type] || null;
}

var NOTIFICATION_TYPE_HANDLERS = {
  medication: {
    icon: "/icons/icon-512x512.png",
    badge: "/icons/pills-128x128.png",
    tag: function (n) {
      if (n && n.tag) return n.tag;
      var personId = n.person_id || n.personId || "";
      return "medication-" + (personId ? personId : "no-person");
    },
    renotify: true,
    getActions: function (lang) {
      var labels = getMedicationActionLabels(lang);
      return [
        { action: "confirm", title: labels.confirm },
        { action: "skip", title: labels.skip },
      ];
    },
    getTitle: function (n, lang) {
      return (n.medicationName != null && n.amount != null) ? getMedicationTitle(n, lang) : (n.title || "Notification");
    },
    getBody: function (n, lang) {
      var items = n.medItems || (n.med_items && Array.isArray(n.med_items) ? n.med_items : null);
      if (Array.isArray(items) && items.length > 0) {
        return items.map(function (item) {
          return getMedicationBody(
            {
              medicationName: item.medicationName,
              amount: item.amount,
              unit: item.unit,
              body: item.body,
            },
            lang
          );
        }).join("\n");
      }
      return (n.medicationName != null && n.amount != null) ? getMedicationBody(n, lang) : (n.body || "");
    },
    getData: function (n, baseData) {
      var extra = getMedicationData(n);
      return Object.assign({}, baseData, extra);
    },
    onActionClick: function (event, data, action) {
      var doseEventIds = data.dose_event_ids;
      if (!Array.isArray(doseEventIds) || doseEventIds.length === 0) return null;
      // Normalize: some mobile browsers report button title (e.g. "Confirm", "Подтвердить") instead of action id ("confirm")
      var raw = String(action || "").trim();
      var normalized = raw.toLowerCase();
      var isConfirm = normalized === "confirm" || normalized === "подтвердить";
      var isSkip = normalized === "skip" || normalized === "пропустить";
      if (!isConfirm && !isSkip) return null;
      var apiAction = isConfirm ? "taken" : "skipped";
      return fetch(self.location.origin + "/api/notifications/medication-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dose_event_ids: doseEventIds, action: apiAction }),
      });
    },
  },
};

// ---------------------------------------------------------------------------
// Common: build options and show notification
// ---------------------------------------------------------------------------
function resolveUrl(n) {
  var url = n.url;
  if (!url) return "/";
  return url.startsWith("/") ? self.location.origin + url : url;
}

function buildNotificationOptions(n, lang) {
  var type = n.type || "";
  var handler = getTypeHandler(type);
  var baseData = {
    url: resolveUrl(n),
    type: type,
  };
  var title = n.title || "Notification";
  var body = n.body;
  var icon = DEFAULT_ICON;
  var badge = DEFAULT_ICON;
  var image;
  var actions;
  var data = baseData;

  if (handler) {
    if (handler.icon != null) icon = handler.icon;
    if (handler.badge != null) badge = handler.badge;
    if (handler.image != null) image = handler.image;
    if (typeof handler.getTitle === "function") title = handler.getTitle(n, lang);
    if (typeof handler.getBody === "function") body = handler.getBody(n, lang);
    if (typeof handler.getActions === "function") actions = handler.getActions(lang);
    if (typeof handler.getData === "function") data = handler.getData(n, baseData);
  }

  var tag = n && n.tag ? n.tag : null;
  if (!tag && handler && handler.tag != null) {
    tag = (typeof handler.tag === "function" ? handler.tag(n) : handler.tag);
  }
  if (!tag) {
    var fallbackPersonId = n && (n.person_id || n.personId) ? (n.person_id || n.personId) : "";
    if (n && n.id) {
      tag = "notification-" + (fallbackPersonId ? fallbackPersonId + "-" : "") + n.id;
    } else {
      tag = "notification-" + Date.now();
    }
  }
  var renotify = (handler && handler.renotify != null) ? handler.renotify : false;
  var options = {
    body: body,
    icon: icon,
    badge: badge,
    vibrate: [100, 50, 100],
    tag: tag,
    renotify: renotify,
    requireInteraction: true,
    data: data,
  };
  var prefix = resolveTitlePrefix(n);
  title = applyTitlePrefix(title, prefix);
  if (image != null) options.image = image;
  if (actions != null && actions.length > 0) options.actions = actions;
  return { title: title, options: options };
}

// ---------------------------------------------------------------------------
// Common: handle action click (open URL or type-specific handler)
// ---------------------------------------------------------------------------
function openNotificationUrl(url, actionBaseUrl) {
  var base = actionBaseUrl || self.location.origin;
  var resolved = (url || "/").startsWith("http") ? url : base + (url.startsWith("/") ? url : "/" + url);
  return self.clients.matchAll({ type: "window" }).then(function (clientList) {
    for (var i = 0; i < clientList.length; i++) {
      var client = clientList[i];
      if (client.url.indexOf(self.registration.scope) !== -1 && "focus" in client) {
        client.navigate(resolved);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(resolved);
  });
}

function handleNotificationClick(event, data, action) {
  var type = data.type || "";
  var handler = getTypeHandler(type);

  if (handler && typeof handler.onActionClick === "function") {
    var result = handler.onActionClick(event, data, action);
    if (result && typeof result.then === "function") return result;
  }

  if (action === "dismiss") return null;
  if (action === "settings") {
    var url = data.url || "/";
    var settingsUrl = url.startsWith("http") ? new URL("/settings", url).href : (data.actionBaseUrl || self.location.origin) + "/settings";
    return openNotificationUrl(settingsUrl, data.actionBaseUrl);
  }

  return openNotificationUrl(data.url || "/", data.actionBaseUrl);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
self.addEventListener("install", function (event) {
  console.log("Service Worker installing.");
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  console.log("Service Worker activated.");
  event.waitUntil(self.clients.claim());
});

// ---------------------------------------------------------------------------
// Push: show notifications (batch or single)
// ---------------------------------------------------------------------------
self.addEventListener("push", function (event) {
  if (!event.data) return;
  var data = event.data.json();
  if (data.notifications && Array.isArray(data.notifications)) {
    var promise = getAppLang().then(function (lang) {
      if (!self.registration.showNotification) return;
      return Promise.all(
        data.notifications.map(function (n) {
          var built = buildNotificationOptions(n, lang);
          return self.registration
            .showNotification(built.title, built.options)
            .then(function () {
              var ids = n.ids && Array.isArray(n.ids) ? n.ids : (n.id ? [n.id] : null);
              if (ids && ids.length > 0) {
                return fetch(self.location.origin + "/api/notifications/mark-shown", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(ids.length === 1 ? { id: ids[0] } : { ids: ids }),
                });
              }
            });
        })
      );
    });
    event.waitUntil(promise);
    return;
  }
  if (data.title) {
    var options = {
      body: data.body,
      icon: data.icon || DEFAULT_ICON,
      badge: data.badge || DEFAULT_ICON,
      vibrate: [100, 50, 100],
      requireInteraction: true,
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.primaryKey || "1",
        url: data.url || "/",
        type: data.type || "",
      },
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  }
});

// ---------------------------------------------------------------------------
// Notification click: dispatch to type handler or default (open URL)
// ---------------------------------------------------------------------------
self.addEventListener("notificationclick", function (event) {
  console.log("Notification click received.", event.action);
  event.notification.close();

  var data = event.notification.data || {};
  var action = event.action || "";

  var result = handleNotificationClick(event, data, action);
  if (result && typeof result.then === "function") {
    event.waitUntil(result);
  }
});

// ---------------------------------------------------------------------------
// Message: show notification (poll path — same logic as push)
// ---------------------------------------------------------------------------
self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== "showNotification" || !data.notification) return;
  var notification = data.notification;
  var client = event.source;
  getAppLang()
    .then(function (lang) {
      if (!self.registration.showNotification) return;
      var built = buildNotificationOptions(notification, lang);
      return self.registration.showNotification(built.title, built.options).then(function () {
        var ids = notification.ids && Array.isArray(notification.ids)
          ? notification.ids
          : (notification.id ? [notification.id] : null);
        if (ids && ids.length > 0) {
          return fetch(self.location.origin + "/api/notifications/mark-shown", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ids.length === 1 ? { id: ids[0] } : { ids: ids }),
          });
        }
      });
    })
    .then(function () {
      if (client && client.postMessage) {
        var idsToNotify = notification.ids && Array.isArray(notification.ids)
          ? notification.ids
          : (notification.id ? [notification.id] : []);
        client.postMessage({ type: "notificationShown", ids: idsToNotify });
      }
    })
    .catch(function () {
      if (client && client.postMessage) {
        var idsToNotify = notification.ids && Array.isArray(notification.ids)
          ? notification.ids
          : (notification.id ? [notification.id] : []);
        client.postMessage({ type: "notificationShown", ids: idsToNotify });
      }
    });
});

// ---------------------------------------------------------------------------
// Fetch (offline support)
// ---------------------------------------------------------------------------
self.addEventListener("fetch", function (event) {
  // Let the browser handle the request normally
});
