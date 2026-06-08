import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Dynamically synchronize client clock with authoritative global time APIs
const OriginalDate = window.Date;
let timeOffset = 0;

async function syncGlobalTime() {
  // 1. Try timeapi.io
  try {
    const res = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia/Jakarta');
    if (res.ok) {
      const data = await res.json();
      if (data && data.dateTime) {
        // dateTime is local to Jakarta. Append '+07:00' timezone designator to parse correct absolute UTC epoch
        const officialDate = new OriginalDate(data.dateTime + '+07:00');
        if (!isNaN(officialDate.getTime())) {
          timeOffset = officialDate.getTime() - OriginalDate.now();
          console.log('Successfully synchronized clock via timeapi.io. Dynamic Offset:', timeOffset, 'ms');
          return;
        }
      }
    }
  } catch (e) {
    console.warn('timeapi.io sync offline/failed, trying fallback:', e);
  }

  // 2. Try worldtimeapi.org fallback
  try {
    const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Jakarta');
    if (res.ok) {
      const data = await res.json();
      if (data && (data.utc_datetime || data.datetime)) {
        const officialDate = new OriginalDate(data.utc_datetime || data.datetime);
        if (!isNaN(officialDate.getTime())) {
          timeOffset = officialDate.getTime() - OriginalDate.now();
          console.log('Successfully synchronized clock via worldtimeapi.org. Dynamic Offset:', timeOffset, 'ms');
          return;
        }
      }
    }
  } catch (e) {
    console.warn('worldtimeapi.org sync offline/failed, trying google fallback:', e);
  }

  // 3. Try Google Date HTTP response header as a highly reliable fallback
  try {
    const res = await fetch('https://www.google.com', { method: 'HEAD', cache: 'no-store' });
    const dateHeader = res.headers.get('date');
    if (dateHeader) {
      const officialDate = new OriginalDate(dateHeader);
      if (!isNaN(officialDate.getTime())) {
        timeOffset = officialDate.getTime() - OriginalDate.now();
        console.log('Successfully synchronized clock via Google GFE HTTP Header. Dynamic Offset:', timeOffset, 'ms');
        return;
      }
    }
  } catch (e) {
    console.error('All credential time APIs failed to synchronize, operating on standard browser time:', e);
  }
}

// Fire off background synchronization immediately
syncGlobalTime();

class CustomDate extends OriginalDate {
  constructor(...args: any[]) {
    if (args.length === 0) {
      super(OriginalDate.now() + timeOffset);
    } else if (args.length === 1) {
      super(args[0]);
    } else if (args.length === 2) {
      super(args[0], args[1]);
    } else if (args.length === 3) {
      super(args[0], args[1], args[2]);
    } else if (args.length === 4) {
      super(args[0], args[1], args[2], args[3]);
    } else if (args.length === 5) {
      super(args[0], args[1], args[2], args[3], args[4]);
    } else if (args.length === 6) {
      super(args[0], args[1], args[2], args[3], args[4], args[5]);
    } else {
      super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }
  }
}

// Preserve static methods and adapt now() to use the dynamic synchronized offset
(CustomDate as any).now = function() {
  return OriginalDate.now() + timeOffset;
};
(CustomDate as any).UTC = OriginalDate.UTC;
(CustomDate as any).parse = OriginalDate.parse;

window.Date = CustomDate as any;

const originalFetch = window.fetch;
Object.defineProperty(window, 'fetch', {
  configurable: true,
  enumerable: true,
  writable: true,
  value: async function(resource: RequestInfo | URL, config?: RequestInit) {
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
      config = config || {};
      const headers = { ...config.headers };
      
      try {
        const storedUser = localStorage.getItem('erp_user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          if (user && user.username) {
            (headers as any)['x-user-email'] = user.username;
          }
        }
      } catch (e) {
        // Ignored
      }
      config.headers = headers;
    }
    
    return originalFetch.call(window, resource, config);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


