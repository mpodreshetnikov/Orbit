// Service Worker for PWA functionality

self.addEventListener("install", (event) => {
  console.log("Service Worker installing.");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activated.");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  if (data.notifications && Array.isArray(data.notifications)) {
    const promise = self.registration.showNotification
      ? Promise.all(
          data.notifications.map((n) => {
            const url = n.url && n.url.startsWith("/") ? self.location.origin + n.url : (n.url || "/");
            return self.registration
              .showNotification(n.title || "Notification", {
                body: n.body,
                icon: "/icons/icon-192x192.png",
                badge: "/icons/icon-192x192.png",
                vibrate: [100, 50, 100],
                tag: n.id ? "notification-" + n.id : "notification-" + Date.now(),
                data: { url },
              })
              .then(() => {
                if (n.id) {
                  return fetch(self.location.origin + "/api/notifications/mark-shown", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: n.id }),
                  });
                }
              });
          })
        )
      : Promise.resolve();
    event.waitUntil(promise);
    return;
  }
  if (data.title) {
    const options = {
      body: data.body,
      icon: data.icon || "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: data.primaryKey || "1",
        url: data.url || "/",
      },
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  }
});

self.addEventListener("notificationclick", (event) => {
  console.log("Notification click received.");
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientList) => {
      // Check if there's already an open window
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Open a new window if none found
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

// Handle fetch events for basic offline support
self.addEventListener("fetch", (event) => {
  // Let the browser handle the request normally
  // Add caching strategies here if needed
});
