/**
 * Date, month and time fields: typing only digits is enough (the dots, slash and colon come by themselves:
 * lib/datefmt.ts), and a button next to the box opens a small pop-up to tap instead: a calendar for a day, the
 * twelve months of a year for a month (the TÜV sticker), and two wheels for a time, like a phone's alarm clock
 * (minutes in steps of 5; any minute can still be typed). Built here rather than the phone's own picker, so it works
 * the same in the web app and in Expo Go without a new native package.
 *
 * The fields still hold the text as typed ("31.03.2027", "03/2027", "09:30"); the forms read it as before
 * (parseDay, readTime), so what is saved and the messages for a wrong date don't change.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextInputProps } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { Button, F, Field, T, hs, useColors } from '@/components/ui';
import { MINUTE_STEP, dayText, isoOf, monthGrid, monthText, pickable, readTime, typeDay, typeMonth, typeTime, wheelMinute } from '@/lib/datefmt';
import { parseDay, today } from '@/lib/fleet';
import { back, fwd, loc, t } from '@/lib/i18n';

type Base = { label: string; hint?: string; error?: string | null; value: string; onChangeText: (v: string) => void } & Omit<TextInputProps, 'value' | 'onChangeText'>;

const isoParts = (iso: string) => iso.split('-').map(Number) as [number, number, number];
const monthName = (y: number, m: number, style: 'long' | 'short') =>
  new Intl.DateTimeFormat(loc(), { month: style, timeZone: 'UTC' }).format(Date.UTC(y, m, 1));
const monthTitle = (y: number, m: number) => new Intl.DateTimeFormat(loc(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m, 1));

/** A day, typed as 31.03.2027 or picked in a calendar. `min` / `max` ("YYYY-MM-DD"): days outside can't be picked. */
/**
 * The least width a day field and a time field need beside each other, so their hints ("DD.MM.YYYY", "NN.HH.ÉÉÉÉ") fit
 * next to the picker button (they were cut at 140 px: blind test, cause 4.2). Rows of them wrap when there's less room.
 */
export const DAY_MIN = 200;
export const TIME_MIN = 150;

export function DateField({ min, max, ...p }: Base & { min?: string | null; max?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Field placeholder={t('DD.MM.YYYY')} keyboardType="numbers-and-punctuation" maxLength={10} {...p}
        onChangeText={(x) => p.onChangeText(typeDay(p.value, x))}
        after={<PickButton icon="day" label={t('Pick a day: {field}', { field: p.label })} onPress={() => setOpen(true)} />} />
      {open ? <Pop onClose={() => setOpen(false)}>
        <Calendar value={parseDay(p.value)} min={min} max={max} onPick={(iso) => { p.onChangeText(dayText(iso)); setOpen(false); }} onCancel={() => setOpen(false)} />
      </Pop> : null}
    </>
  );
}

/** A month (the TÜV sticker), typed as 03/2027 or picked from the year's twelve months. */
export function MonthField(p: Base) {
  const [open, setOpen] = useState(false);
  const cur = parseDay(p.value);
  return (
    <>
      <Field placeholder={t('MM/YYYY')} keyboardType="numbers-and-punctuation" maxLength={7} {...p}
        onChangeText={(x) => p.onChangeText(typeMonth(p.value, x))}
        after={<PickButton icon="day" label={t('Pick a month: {field}', { field: p.label })} onPress={() => setOpen(true)} />} />
      {open ? <Pop onClose={() => setOpen(false)}>
        <Months year={cur ? isoParts(cur)[0] : isoParts(today())[0]} chosen={cur}
          onPick={(y, m) => { p.onChangeText(monthText(isoOf(y, m, 1))); setOpen(false); }} onCancel={() => setOpen(false)} />
      </Pop> : null}
    </>
  );
}

/** A time, typed as 09:30 (9, 930 work too) or picked on two wheels. */
export function TimeField(p: Base) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Field placeholder={t('HH:MM')} keyboardType="numbers-and-punctuation" maxLength={5} {...p}
        onChangeText={(x) => p.onChangeText(typeTime(p.value, x))}
        onBlur={(e) => { const x = readTime(p.value); if (x && x !== p.value) p.onChangeText(x); p.onBlur?.(e); }}
        after={<PickButton icon="time" label={t('Pick a time: {field}', { field: p.label })} onPress={() => setOpen(true)} />} />
      {open ? <Pop onClose={() => setOpen(false)}>
        <Clock value={readTime(p.value)} onPick={(hm) => { p.onChangeText(hm); setOpen(false); }} onCancel={() => setOpen(false)} />
      </Pop> : null}
    </>
  );
}

function PickButton({ icon, label, onPress }: { icon: 'day' | 'time'; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ width: 52, minHeight: 48, borderWidth: 2, borderColor: c.ink, borderRadius: 4, backgroundColor: c.paper, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Svg width={26} height={26} viewBox="0 0 24 24">
        {icon === 'day' ? (
          <>
            <Rect x={3} y={5} width={18} height={16} rx={2} stroke={c.ink} strokeWidth={2} fill="none" />
            <Line x1={3} y1={10} x2={21} y2={10} stroke={c.ink} strokeWidth={2} />
            <Line x1={8} y1={3} x2={8} y2={7} stroke={c.ink} strokeWidth={2} strokeLinecap="round" />
            <Line x1={16} y1={3} x2={16} y2={7} stroke={c.ink} strokeWidth={2} strokeLinecap="round" />
            <Rect x={7} y={13} width={3} height={3} fill={c.ink} />
          </>
        ) : (
          <>
            <Circle cx={12} cy={12} r={9} stroke={c.ink} strokeWidth={2} fill="none" />
            <Line x1={12} y1={12} x2={12} y2={7} stroke={c.ink} strokeWidth={2} strokeLinecap="round" />
            <Line x1={12} y1={12} x2={16} y2={14} stroke={c.ink} strokeWidth={2} strokeLinecap="round" />
          </>
        )}
      </Svg>
    </Pressable>
  );
}

/** The small window over the page; tapping outside closes it. */
function Pop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const c = useColors();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable accessibilityLabel={t('Close')} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {/* Taps inside don't reach the backdrop. */}
        <Pressable accessible={false} onPress={() => {}} style={{ width: '100%', maxWidth: 360, backgroundColor: c.paper, borderWidth: 2, borderColor: c.ink, borderRadius: 6, padding: 14, gap: 10 }}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Arrow({ text, label, onPress, disabled }: { text: string; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.ink, borderRadius: 4, opacity: disabled ? 0.3 : 1 }}>
      <Text style={{ fontFamily: F.condBold, fontSize: 30, lineHeight: 32, color: c.ink }}>{text}</Text>
    </Pressable>
  );
}

/** A month of days from Monday; tap a day. The title opens the months of the year, to jump far (a registration in 2019). */
function Calendar({ value, min, max, onPick, onCancel }: { value: string | null; min?: string | null; max?: string | null; onPick: (iso: string) => void; onCancel: () => void }) {
  const c = useColors();
  const now = today();
  const start = value || (min && now < min ? min : max && now > max ? max : now);
  const [sy, sm] = isoParts(start);
  const [view, setView] = useState({ y: sy, m: sm - 1 });
  const [months, setMonths] = useState(false);
  if (months) {
    return <Months year={view.y} chosen={value} min={min} max={max} onPick={(y, m) => { setView({ y, m }); setMonths(false); }} onCancel={() => setMonths(false)} />;
  }
  const step = (d: number) => setView(({ y, m }) => ({ y: y + Math.floor((m + d) / 12), m: (m + d + 12) % 12 }));
  const firstOf = isoOf(view.y, view.m, 1);
  const lastOf = isoOf(view.y, view.m, new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate());
  const wd = new Intl.DateTimeFormat(loc(), { weekday: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Arrow text={back()} label={t('Previous month')} disabled={!!min && firstOf <= min} onPress={() => step(-1)} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Choose month and year')} onPress={() => setMonths(true)} style={{ flex: 1, alignItems: 'center', minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.cond, fontSize: hs(22), color: c.ink, textDecorationLine: 'underline' }}>{monthTitle(view.y, view.m)}</Text>
        </Pressable>
        <Arrow text={fwd()} label={t('Next month')} disabled={!!max && lastOf >= max} onPress={() => step(1)} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {/* 1 Jan 2024 was a Monday. */}
        {Array.from({ length: 7 }, (_, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: F.medium, fontSize: 13, color: c.ink2 }}>{wd.format(Date.UTC(2024, 0, 1 + i))}</Text>
        ))}
      </View>
      {monthGrid(view.y, view.m).map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row' }}>
          {week.map((d, i) => {
            if (!d) return <View key={i} style={{ flex: 1, height: 42 }} />;
            const iso = isoOf(view.y, view.m, d);
            const ok = pickable(iso, min, max);
            const on = iso === value;
            const isToday = iso === now;
            return (
              <Pressable key={i} accessibilityRole="button" accessibilityLabel={long.format(Date.UTC(view.y, view.m, d))}
                accessibilityState={{ selected: on, disabled: !ok }} disabled={!ok} onPress={() => onPick(iso)}
                style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? c.ink : 'transparent', borderWidth: isToday && !on ? 2 : 0, borderColor: c.ink }}>
                  <Text style={{ fontFamily: on || isToday ? F.semi : F.body, fontSize: 17, color: on ? c.paper : ok ? c.ink : c.rule, fontVariant: ['tabular-nums'],
                    textDecorationLine: ok ? 'none' : 'line-through' }}>{d}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        {pickable(now, min, max) ? <Button small title={t('Today')} onPress={() => onPick(now)} /> : <View />}
        <Button small v="link" title={t('Cancel')} onPress={onCancel} />
      </View>
    </View>
  );
}

/** The twelve months of a year; arrows change the year. */
function Months({ year, chosen, min, max, onPick, onCancel }: { year: number; chosen: string | null; min?: string | null; max?: string | null; onPick: (y: number, m: number) => void; onCancel: () => void }) {
  const c = useColors();
  const [y, setY] = useState(year);
  const cy = chosen ? isoParts(chosen)[0] : null, cm = chosen ? isoParts(chosen)[1] - 1 : null;
  const [ty, tm] = isoParts(today());
  // A month can be picked when any of its days can.
  const ok = (m: number) => pickable(isoOf(y, m, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()), min, null) && pickable(isoOf(y, m, 1), null, max);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Arrow text={back()} label={t('Previous year')} disabled={!!min && `${y}` <= min.slice(0, 4)} onPress={() => setY(y - 1)} />
        <Text accessibilityRole="header" style={{ flex: 1, textAlign: 'center', fontFamily: F.cond, fontSize: hs(24), color: c.ink, fontVariant: ['tabular-nums'] }}>{y}</Text>
        <Arrow text={fwd()} label={t('Next year')} disabled={!!max && `${y}` >= max.slice(0, 4)} onPress={() => setY(y + 1)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: 12 }, (_, m) => {
          const on = y === cy && m === cm;
          const can = ok(m);
          return (
            <View key={m} style={{ width: '33.333%', padding: 4 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={monthTitle(y, m)} accessibilityState={{ selected: on, disabled: !can }} disabled={!can} onPress={() => onPick(y, m)}
                style={{ minHeight: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.ink : 'transparent',
                  borderWidth: 2, borderColor: on ? c.ink : y === ty && m === tm - 1 ? c.ink : c.rule }}>
                <Text style={{ fontFamily: F.medium, fontSize: 16, color: on ? c.paper : can ? c.ink : c.rule }}>{monthName(y, m, 'short')}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={{ alignItems: 'flex-end' }}><Button small v="link" title={t('Cancel')} onPress={onCancel} /></View>
    </View>
  );
}

const ITEM = 44, SHOWN = 5;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Hours and minutes on two wheels that snap; Done takes the time shown in the band. */
function Clock({ value, onPick, onCancel }: { value: string | null; onPick: (hm: string) => void; onCancel: () => void }) {
  const c = useColors();
  const [h0, m0] = (value || '09:00').split(':').map(Number);
  const [h, setH] = useState(h0);
  const [mi, setMi] = useState(wheelMinute(m0));
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ height: ITEM * SHOWN, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {/* The band the chosen time sits in. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ITEM * 2, height: ITEM, borderTopWidth: 2, borderBottomWidth: 2, borderColor: c.ink, backgroundColor: c.page }} />
        <Wheel items={hours} value={h} onChange={setH} label={t('Hours')} />
        <Text style={{ fontFamily: F.condBold, fontSize: 30, color: c.ink }}>:</Text>
        <Wheel items={minutes} value={mi} onChange={setMi} label={t('Minutes')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between' }}>
        <Button small v="link" title={t('Cancel')} onPress={onCancel} />
        <Button small v="primary" title={t('Done')} onPress={() => onPick(`${pad2(h)}:${pad2(mi)}`)} />
      </View>
    </View>
  );
}

function Wheel({ items, value, onChange, label }: { items: number[]; value: number; onChange: (n: number) => void; label: string }) {
  const c = useColors();
  const ref = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idx = Math.max(0, items.indexOf(value));
  const go = (i: number, animated = true) => ref.current?.scrollTo({ y: i * ITEM, animated });
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  // Wherever the scroll stops (a flick, a drag, a mouse wheel on the web, which sends no "end" event): the nearest item.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const i = Math.min(items.length - 1, Math.max(0, Math.round(y / ITEM)));
      if (Math.abs(y - i * ITEM) > 1) go(i);
      if (items[i] !== value) onChange(items[i]);
    }, 120);
  };
  return (
    <ScrollView ref={ref} accessibilityLabel={label} style={{ width: 84, height: ITEM * SHOWN, flexGrow: 0 }} showsVerticalScrollIndicator={false}
      snapToInterval={ITEM} decelerationRate="fast" scrollEventThrottle={16} onScroll={onScroll}
      contentOffset={{ x: 0, y: idx * ITEM }} onLayout={() => go(idx, false)}
      contentContainerStyle={{ paddingVertical: ITEM * 2 }}>
      {items.map((n, i) => (
        <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${label} ${pad2(n)}`} accessibilityState={{ selected: n === value }}
          onPress={() => { go(i); onChange(n); }} style={{ height: ITEM, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: n === value ? F.condBold : F.cond, fontSize: n === value ? 30 : 24, color: n === value ? c.ink : c.ink2, fontVariant: ['tabular-nums'] }}>{pad2(n)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
