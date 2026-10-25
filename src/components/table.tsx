import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { F, MARKER, useColors } from '@/components/ui';
import { t } from '@/lib/i18n';

/**
 * A spreadsheet-like table: the first column (who or what) stays put while the rest scrolls sideways; tap a
 * column heading to sort by it, again to reverse. A totals row sits on top, so it's visible without scrolling down.
 */

export interface Col<R> {
  key: string;
  label: string;
  width: number;
  /** The value to sort by (and what the Excel file gets, unless `xl` says otherwise). */
  get: (r: R) => number | string | null;
  /** What the cell shows (default: the value). */
  text?: (r: R) => string;
  /** A colour for the cell, to point at what needs a look. */
  tone?: (r: R) => string | undefined;
  align?: 'left' | 'right';
  /** The totals row. */
  total?: (rows: R[]) => string;
}
export interface Sort { key: string; dir: 1 | -1 }

const ROW = 44, HEAD = 56;

export function sortRows<R>(rows: R[], cols: Col<R>[], sort: Sort | null): R[] {
  const col = sort && cols.find((c) => c.key === sort.key);
  if (!col || !sort) return rows;
  return [...rows].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    // Empty cells always go last.
    if (x == null || x === '') return y == null || y === '' ? 0 : 1;
    if (y == null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
}

export function DataTable<R>({ rows, cols, rowKey, onRow, sort, onSort, totalLabel, empty }: {
  rows: R[]; cols: Col<R>[]; rowKey: (r: R) => string; onRow?: (r: R) => void;
  sort: Sort | null; onSort: (s: Sort) => void; totalLabel?: string; empty: string;
}) {
  const c = useColors();
  const [limit, setLimit] = useState(60);
  const [first, ...rest] = cols;
  const shown = rows.slice(0, limit);
  const hasTotal = !!totalLabel && cols.some((x) => x.total);
  const head = (col: Col<R>, i: number, frozen: boolean) => {
    const on = sort?.key === col.key;
    return (
      <Pressable key={col.key} accessibilityRole="button" accessibilityLabel={t('Sort by {column}', { column: col.label })} onPress={() => onSort({ key: col.key, dir: on ? (sort!.dir === 1 ? -1 : 1) : col.align === 'left' ? 1 : -1 })}
        style={{ width: col.width, height: HEAD, paddingHorizontal: 8, justifyContent: 'flex-end', paddingBottom: 6, alignItems: col.align === 'left' ? 'flex-start' : 'flex-end',
          backgroundColor: on ? MARKER : c.ink, borderLeftWidth: i && !frozen ? 1 : 0, borderColor: c.dark ? '#2A2E35' : '#2A2E35' }}>
        <Text numberOfLines={2} style={{ fontFamily: F.cond, fontSize: 15, lineHeight: 17, color: on ? '#000' : c.paper, textAlign: col.align === 'left' ? 'left' : 'right' }}>
          {col.label}{on ? (sort!.dir === 1 ? ' ▲' : ' ▼') : ''}
        </Text>
      </Pressable>
    );
  };
  const cell = (col: Col<R>, r: R, i: number, frozen: boolean, bold = false) => {
    const v = col.text ? col.text(r) : col.get(r);
    return (
      <View key={col.key} style={{ width: col.width, height: ROW, paddingHorizontal: 8, justifyContent: 'center', alignItems: col.align === 'left' ? 'flex-start' : 'flex-end', borderLeftWidth: i && !frozen ? 1 : 0, borderColor: c.rule }}>
        <Text numberOfLines={1} style={{ fontFamily: frozen ? F.semi : bold ? F.condBold : F.condMed, fontSize: frozen ? 15 : 17, color: col.tone?.(r) || c.ink, fontVariant: ['tabular-nums'] }}>
          {v == null || v === '' ? '–' : String(v)}
        </Text>
      </View>
    );
  };
  const totalCell = (col: Col<R>, i: number, frozen: boolean) => (
    <View key={col.key} style={{ width: col.width, height: ROW, paddingHorizontal: 8, justifyContent: 'center', alignItems: col.align === 'left' ? 'flex-start' : 'flex-end', borderLeftWidth: i && !frozen ? 1 : 0, borderColor: c.rule }}>
      <Text numberOfLines={1} style={{ fontFamily: F.condBold, fontSize: 17, color: c.ink, fontVariant: ['tabular-nums'] }}>{frozen ? totalLabel : col.total ? col.total(rows) : ''}</Text>
    </View>
  );
  const line = (k: number) => ({ borderTopWidth: 1, borderColor: c.rule, backgroundColor: k % 2 ? (c.dark ? '#20242A' : '#F5F6F8') : c.paper });
  if (!rows.length) {
    return <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: c.ink2, borderRadius: 4, padding: 14 }}><Text style={{ fontFamily: F.body, fontSize: 14, color: c.ink2 }}>{empty}</Text></View>;
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: c.ink, borderRadius: 4, overflow: 'hidden', backgroundColor: c.paper }}>
        {/* The first column stays while the others scroll. */}
        <View style={{ width: first.width, borderRightWidth: 2, borderColor: c.ink, zIndex: 1, backgroundColor: c.paper }}>
          {head(first, 0, true)}
          {hasTotal ? <View style={{ borderTopWidth: 0, backgroundColor: c.dark ? '#2A2E35' : '#E3E6EA' }}>{totalCell(first, 0, true)}</View> : null}
          {shown.map((r, k) => (
            <Pressable key={rowKey(r)} disabled={!onRow} onPress={() => onRow?.(r)} accessibilityRole={onRow ? 'button' : undefined} style={line(k)}>
              {cell(first, r, 0, true)}
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
          <View>
            <View style={{ flexDirection: 'row' }}>{rest.map((col, i) => head(col, i, false))}</View>
            {hasTotal ? <View style={{ flexDirection: 'row', backgroundColor: c.dark ? '#2A2E35' : '#E3E6EA' }}>{rest.map((col, i) => totalCell(col, i, false))}</View> : null}
            {shown.map((r, k) => (
              <Pressable key={rowKey(r)} disabled={!onRow} onPress={() => onRow?.(r)} style={[{ flexDirection: 'row' }, line(k)]}>
                {rest.map((col, i) => cell(col, r, i, false))}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
      {rows.length > shown.length ? (
        <Pressable accessibilityRole="button" onPress={() => setLimit(rows.length)}>
          <Text style={{ fontFamily: F.medium, fontSize: 15, color: c.ink, textDecorationLine: 'underline' }}>Show all {rows.length} rows</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
