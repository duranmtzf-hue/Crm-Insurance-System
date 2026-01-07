// Service Worker para CRM Insurance System
const CACHE_NAME = 'crm-insurance-v6';
const urlsToCache = [
  '/',
  '/dashboard',
  '/vehicles',
  '/policies',
  '/tires',
  '/fines',
  '/claims',
  '/billing',
  '/reports',
  '/tracking',
  '/login',
  '/register',
  '/images/logo.png',
  '/images/icons/icon-192x192.png',
  '/images/icons/icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&family=Open+Sans:wght@300;400;600&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// Timeout para peticiones de red (3 segundos - más agresivo para conexiones lentas)
const NETWORK_TIMEOUT = 3000;

// Función helper para fetch con timeout
function fetchWithTimeout(request, timeout = NETWORK_TIMEOUT) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), timeout)
    )
  ]);
}

// Instalación del Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache abierto');
        // Cachear sin esperar a que todas las URLs se resuelvan
        return cache.addAll(urlsToCache).catch((err) => {
          console.log('Algunos recursos no se pudieron cachear:', err);
          // Continuar aunque algunos recursos fallen
        });
      })
      .catch((err) => {
        console.log('Error al cachear:', err);
      })
  );
  self.skipWaiting();
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Estrategia mejorada: Cache First para recursos estáticos, Network First con timeout para páginas
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // EXCLUIR rutas críticas de autenticación del service worker
  // Estas rutas deben ir directamente al servidor sin interceptación
  const excludedPaths = ['/login', '/register', '/logout', '/api/login', '/api/register'];
  const isExcluded = excludedPaths.some(path => url.pathname === path || url.pathname.startsWith(path + '/'));
  
  if (isExcluded) {
    // Dejar pasar directamente sin interceptar
    return;
  }
  
  // Para requests a la API o métodos que no sean GET, usar Network First con timeout más largo
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    // Timeout más largo para peticiones POST/PUT/DELETE (10 segundos)
    const timeout = event.request.method !== 'GET' ? 10000 : 3000;
    
    event.respondWith(
      fetchWithTimeout(event.request.clone(), timeout)
        .then((response) => {
          // Si la respuesta es válida, devolverla
          if (response && response.status < 500) {
            return response;
          }
          // Si hay error del servidor, intentar devolver una respuesta de error apropiada
          throw new Error('Server error');
        })
        .catch((error) => {
          // Si falla la red o hay timeout, devolver una respuesta de error JSON
          // para que la app pueda manejar el error gracefully
          if (url.pathname.startsWith('/api/')) {
            return new Response(
              JSON.stringify({ 
                error: 'Sin conexión a internet. Por favor, verifica tu conexión.',
                offline: true 
              }),
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
              }
            );
          }
          // Para otros métodos, devolver error genérico
          return new Response('Sin conexión', { status: 503 });
        })
    );
    return;
  }

  // Para recursos estáticos (CSS, JS, imágenes), usar Cache First
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/)) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si no está en cache, intentar obtenerlo de la red con timeout
          return fetchWithTimeout(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              }
              return response;
            })
            .catch(() => {
              // Si falla la red, devolver una respuesta vacía o error según el tipo
              if (url.pathname.match(/\.(css|js)$/)) {
                return new Response('/* Resource unavailable offline */', {
                  headers: { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' }
                });
              }
              return new Response('', { status: 404 });
            });
        })
    );
    return;
  }

  // Para páginas HTML, usar Network First con timeout
  event.respondWith(
    fetchWithTimeout(event.request.clone())
      .then((response) => {
        // Si la respuesta es válida (200-299), clonarla y guardarla en cache
        if (response && response.status >= 200 && response.status < 300) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        // Incluso si es un error 401/403, devolver la respuesta para que el usuario vea el login
        return response;
      })
      .catch((error) => {
        // Si falla la red o hay timeout, intentar desde cache
        return caches.match(event.request).then((response) => {
          if (response) {
            return response;
          }
          // Si no hay en cache y es una página, devolver dashboard o index
          if (event.request.destination === 'document') {
            return caches.match('/dashboard').then((dashboardResponse) => {
              return dashboardResponse || caches.match('/');
            });
          }
          // Si no hay nada en cache, devolver una respuesta básica
          return new Response('Sin conexión. Por favor, verifica tu conexión a internet.', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        });
      })
  );
});

