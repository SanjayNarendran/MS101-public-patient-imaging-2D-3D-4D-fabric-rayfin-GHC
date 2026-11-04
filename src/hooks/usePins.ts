import { useCallback, useEffect, useState } from 'react';

import type { SlidePin } from '../../rayfin/data/SlidePin';
import { useAuth } from '@/hooks/AuthContext';
import { LOCAL_DATA } from '@/lib/localData';
import { getRayfinClient } from '@/services/rayfin/RayfinClientService';

export type Pin = Pick<
  SlidePin,
  'id' | 'slideId' | 'title' | 'note' | 'x' | 'y' | 'zoom' | 'createdBy' | 'authorName' | 'createdAt'
>;

const FIELDS = [
  'id',
  'slideId',
  'title',
  'note',
  'x',
  'y',
  'zoom',
  'createdBy',
  'authorName',
  'createdAt',
] as const;

const LOCAL_PINS_KEY = 'atlas.localPins';

function readLocalPins(): Pin[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PINS_KEY) ?? '[]') as Pin[];
  } catch {
    return [];
  }
}

function writeLocalPins(pins: Pin[]): void {
  localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(pins));
}

/** Local data mode: pins live in this browser only (there is no database). */
function useLocalPins(slideId: string) {
  const { user } = useAuth();
  const [pins, setPins] = useState<Pin[]>(() => readLocalPins().filter((p) => p.slideId === slideId));
  useEffect(() => setPins(readLocalPins().filter((p) => p.slideId === slideId)), [slideId]);
  const currentUserId = user?.id ?? 'local-viewer';

  const addPin = useCallback(
    async (input: { title: string; note?: string; x: number; y: number; zoom: number }) => {
      const pin = {
        id: crypto.randomUUID(),
        slideId,
        title: input.title,
        note: input.note || undefined,
        x: Number(input.x.toFixed(8)),
        y: Number(input.y.toFixed(8)),
        zoom: Number(input.zoom.toFixed(6)),
        createdBy: currentUserId,
        authorName: user?.name || 'Local viewer',
        createdAt: new Date(),
      } as unknown as Pin;
      writeLocalPins([...readLocalPins(), pin]);
      setPins((prev) => [...prev, pin]);
    },
    [slideId, user, currentUserId]
  );

  const removePin = useCallback(async (id: string) => {
    writeLocalPins(readLocalPins().filter((p) => p.id !== id));
    setPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const refresh = useCallback(async () => setPins(readLocalPins().filter((p) => p.slideId === slideId)), [slideId]);

  return { pins, loading: false, error: null as string | null, addPin, removePin, refresh, currentUserId };
}

/** Shared regions of interest for one slide, stored in the Rayfin (Fabric SQL) database. */
export function usePins(slideId: string) {
  // LOCAL_DATA is a build-time constant, so the hook order never changes between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return LOCAL_DATA ? useLocalPins(slideId) : useRayfinPins(slideId);
}

function useRayfinPins(slideId: string) {
  const { user } = useAuth();
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await getRayfinClient()
        .data.SlidePin.select([...FIELDS])
        .where({ slideId: { eq: slideId } })
        .orderBy({ createdAt: 'asc' })
        .execute();
      setPins(rows as Pin[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [slideId]);

  useEffect(() => {
    setLoading(true);
    setPins([]);
    void refresh();
  }, [refresh]);

  const addPin = useCallback(
    async (input: { title: string; note?: string; x: number; y: number; zoom: number }) => {
      const userId = getRayfinClient().auth.getSession().user?.id ?? user?.id;
      if (!userId) throw new Error('Sign in to pin regions');
      const created = await getRayfinClient().data.SlidePin.create({
        slideId,
        title: input.title,
        note: input.note || undefined,
        x: Number(input.x.toFixed(8)),
        y: Number(input.y.toFixed(8)),
        zoom: Number(input.zoom.toFixed(6)),
        createdBy: userId,
        authorName: (user?.name || user?.email || 'Fabric user').slice(0, 128),
        createdAt: new Date(),
      });
      setPins((prev) => [...prev, created as Pin]);
    },
    [slideId, user]
  );

  const removePin = useCallback(async (id: string) => {
    await getRayfinClient().data.SlidePin.delete({ id });
    setPins((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const currentUserId = getRayfinClient().auth.getSession().user?.id ?? user?.id;

  return { pins, loading, error, addPin, removePin, refresh, currentUserId };
}
