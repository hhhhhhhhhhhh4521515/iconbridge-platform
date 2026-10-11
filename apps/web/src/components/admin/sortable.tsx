'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';

function Row({
  id,
  handleLabel,
  disabled,
  children,
}: {
  id: string;
  handleLabel: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-stretch gap-2 rounded-xl border border-border bg-card ${
        isDragging ? 'relative z-10 shadow-lg' : ''
      }`}
      data-testid="sortable-row"
      data-id={id}
    >
      {disabled ? null : (
        <button
          type="button"
          className="flex w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-s-xl text-muted-foreground hover:bg-muted"
          aria-label={handleLabel}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <div className={`min-w-0 flex-1 p-3 ${disabled ? 'ps-4' : 'ps-0'}`}>{children}</div>
    </li>
  );
}

/**
 * A list whose rows are reordered by dragging their handle, or with the keyboard:
 * focus the handle, press Space, move with the arrows, press Space again.
 */
export function SortableList<Item extends { id: string }>({
  items,
  onReorder,
  render,
  handleLabel,
  disabled = false,
}: {
  items: Item[];
  onReorder: (items: Item[]) => void;
  render: (item: Item) => ReactNode;
  handleLabel: (item: Item) => string;
  disabled?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const from = items.findIndex((item) => item.id === event.active.id);
    const to = items.findIndex((item) => item.id === event.over?.id);
    if (from !== -1 && to !== -1 && from !== to) {
      onReorder(arrayMove(items, from, to));
    }
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {items.map((item) => (
            <Row key={item.id} id={item.id} handleLabel={handleLabel(item)} disabled={disabled}>
              {render(item)}
            </Row>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
