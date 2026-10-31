import { create } from 'zustand';

import {
    addWidget,
    ensureDefaultWidgets,
    hideWidget,
    listHiddenWidgets,
    listWidgets,
    reorderWidgets,
    showWidget,
    updateWidgetSize,
} from '@/db/repo/widgets';
import type { WidgetItem, WidgetSize, WidgetType } from '@/lib/widgetTypes';

interface WidgetState {
  widgets: WidgetItem[];
  hiddenWidgets: WidgetItem[];
  editMode: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setEditMode: (on: boolean) => void;
  resize: (id: string, size: WidgetSize) => Promise<void>;
  remove: (id: string) => Promise<void>;
  add: (id: string) => Promise<void>;
  addType: (type: WidgetType, config?: Record<string, unknown>) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

export const useWidgetStore = create<WidgetState>((set, get) => ({
  widgets: [],
  hiddenWidgets: [],
  editMode: false,
  loaded: false,

  load: async () => {
    await ensureDefaultWidgets();
    const [widgets, hiddenWidgets] = await Promise.all([listWidgets(), listHiddenWidgets()]);
    set({ widgets, hiddenWidgets, loaded: true });
  },

  setEditMode: (on) => set({ editMode: on }),

  resize: async (id, size) => {
    await updateWidgetSize(id, size);
    set({ widgets: get().widgets.map((w) => (w.id === id ? { ...w, size } : w)) });
  },

  remove: async (id) => {
    await hideWidget(id);
    const removed = get().widgets.find((w) => w.id === id);
    set({
      widgets: get().widgets.filter((w) => w.id !== id),
      // Push the post-hide widget (visible: 0), not the stale visible copy.
      hiddenWidgets: removed
        ? [...get().hiddenWidgets, { ...removed, visible: 0 }]
        : get().hiddenWidgets,
    });
  },

  add: async (id) => {
    await showWidget(id);
    await get().load();
  },

  addType: async (type, config) => {
    // Check if there's a hidden widget of this type (and config) to re-show
    const hidden = get().hiddenWidgets.find((w) =>
      w.widget_type === type &&
      JSON.stringify(w.config) === JSON.stringify(config || {})
    );
    if (hidden) {
      await showWidget(hidden.id);
    } else {
      await addWidget(type, config || {});
    }
    await get().load();
  },

  reorder: async (ids) => {
    await reorderWidgets(ids);
    const map = new Map(get().widgets.map((w) => [w.id, w]));
    set({
      widgets: ids.flatMap((id, i) => {
        const w = map.get(id);
        return w ? [{ ...w, sort_order: i }] : [];
      }),
    });
  },
}));
