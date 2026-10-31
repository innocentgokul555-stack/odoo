import { useEffect, useState } from 'react';
import { api } from './api';

// Plans, products, taxes, terms and templates are small lists used by many forms - load them once.
let cache = null;
let pending = null;

export function resetLookups() { cache = null; pending = null; }

export function useLookups() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) { setData(cache); return undefined; }
    let alive = true;
    pending = pending || api('/lookups');
    pending.then((d) => { cache = d; if (alive) setData(d); }).catch(() => { pending = null; });
    return () => { alive = false; };
  }, []);
  return data;
}
