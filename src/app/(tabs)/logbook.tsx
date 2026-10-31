import { useFocusEffect, useRouter } from 'expo-router';
import { Calendar, ChevronLeft, ChevronRight, Download, List, Plus, Trophy } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, cardChrome, CardSheen, Screen, ScreenHeader } from '@/components/ui';
import { Sheet } from '@/components/ui/Sheet';
import { FEELS } from '@/components/workout/WorkoutSummary';
import { clearDayStatus, getDayStatuses, setDayStatus, type DayStatusType } from '@/db/repo/dayStatus';
import {
    listDayLog,
    listLogHistory,
    prCountByMonth,
    workoutCountByMonth,
    type LogEntry,
} from '@/db/repo/workouts';
import { ACTIVITY_META, distanceUnitFor, formatDistance } from '@/lib/cardio';
import { exportWorkoutsCsv } from '@/lib/exportCsv';
import { formatDate, formatDuration, formatVolume } from '@/lib/format';
import { confirm } from '@/store/notify';
import { useSettings } from '@/store/settings';
import { tabular, Void } from '@/theme/tokens';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_LABELS_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const GRID_PAD = 16;
const GAP = 4;
const CELL_SIZE = Math.floor((SCREEN_W - GRID_PAD * 2 - GAP * 6) / 7);
// Taller cells for month view - fill more of the screen.
const CELL_HEIGHT_MONTH = Math.max(CELL_SIZE, Math.floor((SCREEN_H * 0.5) / 6));
const CELL_HEIGHT_WEEK = Math.max(CELL_SIZE, Math.floor(SCREEN_H * 0.18));

type ViewMode = 'calendar' | 'list';
type CalendarMode = 'month' | 'week' | 'day';

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

interface DayCell {
  day: number | null;
  key: string;
  inMonth: boolean;
}

function buildMonthGrid(year: number, month: number): DayCell[] {
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells: DayCell[] = [];

  // Boundary cells carry real dates from the adjacent month so their data
  // (loaded ±1 month) renders instead of a blank tile.
  for (let i = startWeekday; i > 0; i--) {
    const d = new Date(year, month - 1, daysInPrevMonth - i + 1);
    cells.push({ day: d.getDate(), key: dateKey(d.getFullYear(), d.getMonth(), d.getDate()), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: dateKey(year, month, d), inMonth: true });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const d = new Date(year, month + 1, nextDay++);
    cells.push({ day: d.getDate(), key: dateKey(d.getFullYear(), d.getMonth(), d.getDate()), inMonth: false });
  }
  return cells;
}

/** YYYY-MM prefix for a (possibly out-of-range) year/month pair. */
function monthPrefixFor(year: number, month: number): string {
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildWeekGrid(year: number, month: number, day: number): DayCell[] {
  const date = new Date(year, month, day);
  const weekday = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - weekday);

  const cells: DayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    cells.push({
      day: d.getDate(),
      key: dateKey(d.getFullYear(), d.getMonth(), d.getDate()),
      inMonth: d.getMonth() === month,
    });
  }
  return cells;
}

export default function LogbookScreen() {
  const router = useRouter();
  const unit = useSettings((s) => s.weight_unit);
  const userId = useSettings((s) => s.supabase_user_id);

  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [calMode, setCalMode] = useState<CalendarMode>('month');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewDay, setViewDay] = useState(today.getDate());

  const [workoutDays, setWorkoutDays] = useState<Record<string, number>>({});
  const [prDays, setPrDays] = useState<Record<string, number>>({});
  const [dayStatuses, setDayStatuses] = useState<Record<string, DayStatusType>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<LogEntry[]>([]);
  const [allEntries, setAllEntries] = useState<LogEntry[]>([]);

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;

  const refresh = useCallback(async () => {
    if (viewMode === 'list') {
      setAllEntries(await listLogHistory());
      return;
    }
    // Load the viewed month plus one either side so boundary cells (prev/next
    // month days) and weeks that straddle a month still show their data.
    const prefixes = [monthPrefixFor(viewYear, viewMonth - 1), monthPrefix, monthPrefixFor(viewYear, viewMonth + 1)];
    const [wc, pr, st] = await Promise.all([
      Promise.all(prefixes.map(workoutCountByMonth)),
      Promise.all(prefixes.map(prCountByMonth)),
      Promise.all(prefixes.map(getDayStatuses)),
    ]);
    setWorkoutDays(Object.assign({}, ...wc));
    setPrDays(Object.assign({}, ...pr));
    setDayStatuses(Object.assign({}, ...st));
    if (selectedDate) {
      setDayEntries(await listDayLog(selectedDate));
    }
  }, [monthPrefix, selectedDate, viewMode, viewYear, viewMonth]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  // Navigation
  const goPrev = () => {
    if (calMode === 'month') {
      if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
      else setViewMonth((m) => m - 1);
    } else if (calMode === 'week') {
      const d = new Date(viewYear, viewMonth, viewDay);
      d.setDate(d.getDate() - 7);
      setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setViewDay(d.getDate());
    } else {
      const d = new Date(viewYear, viewMonth, viewDay);
      d.setDate(d.getDate() - 1);
      setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setViewDay(d.getDate());
    }
    setSelectedDate(null);
    setDayEntries([]);
  };

  const goNext = () => {
    if (calMode === 'month') {
      if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
      else setViewMonth((m) => m + 1);
    } else if (calMode === 'week') {
      const d = new Date(viewYear, viewMonth, viewDay);
      d.setDate(d.getDate() + 7);
      setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setViewDay(d.getDate());
    } else {
      const d = new Date(viewYear, viewMonth, viewDay);
      d.setDate(d.getDate() + 1);
      setViewYear(d.getFullYear()); setViewMonth(d.getMonth()); setViewDay(d.getDate());
    }
    setSelectedDate(null);
    setDayEntries([]);
  };

  const navTitle = (() => {
    if (calMode === 'month') return `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    if (calMode === 'week') {
      const cells = buildWeekGrid(viewYear, viewMonth, viewDay);
      const first = parseDateKey(cells[0].key);
      const last = parseDateKey(cells[6].key);
      return `${MONTH_NAMES[first.getMonth()].slice(0, 3)} ${first.getDate()} - ${MONTH_NAMES[last.getMonth()].slice(0, 3)} ${last.getDate()}`;
    }
    const d = new Date(viewYear, viewMonth, viewDay);
    return `${DAY_LABELS_FULL[(d.getDay() + 6) % 7]} ${MONTH_NAMES[viewMonth].slice(0, 3)} ${viewDay}`;
  })();

  const cells = calMode === 'month'
    ? buildMonthGrid(viewYear, viewMonth)
    : buildWeekGrid(viewYear, viewMonth, viewDay);

  const onDayPress = async (key: string) => {
    if (selectedDate === key) {
      setSelectedDate(null);
      setDayEntries([]);
      return;
    }
    setSelectedDate(key);
    setDayEntries(await listDayLog(key));
  };

  // Tag the entries with the day they were loaded for, so stale entries can
  // never render under a different day's header.
  const onDayEntriesLoaded = useCallback((key: string, entries: LogEntry[]) => {
    setSelectedDate(key);
    setDayEntries(entries);
  }, []);

  const [dayPromptKey, setDayPromptKey] = useState<string | null>(null);

  const onUnknownDayPress = (key: string) => {
    setDayPromptKey(key);
  };

  const markDay = (status: DayStatusType) => {
    const key = dayPromptKey;
    setDayPromptKey(null);
    if (key) void setDayStatus(key, status, userId).then(refresh);
  };

  const onClearDayStatus = async (key: string) => {
    const ok = await confirm({ title: 'Clear day status?', confirmText: 'CLEAR', destructive: true });
    if (!ok) return;
    void clearDayStatus(key).then(refresh);
  };

  const cellHeight = calMode === 'week' ? CELL_HEIGHT_WEEK : CELL_HEIGHT_MONTH;

  const renderCell = (cell: DayCell) => {
    if (!cell.inMonth && calMode === 'month') {
      // Prev/next-month padding day - dimmed, non-interactive, but with its
      // real counts/status so the grid never reads as unexplained blanks.
      const wc = workoutDays[cell.key] ?? 0;
      const pr = prDays[cell.key] ?? 0;
      const st = dayStatuses[cell.key];
      const dimColor = wc > 0 ? Void.accent : st === 'rest' ? '#6a9eff' : st === 'missed' ? '#ff6a6a' : Void.textTertiary;
      return (
        <View key={cell.key} style={[styles.cell, styles.cellBlank, { height: cellHeight, opacity: 0.35 }]}>
          <Text style={[styles.cellDay, { color: dimColor }]}>{cell.day}</Text>
          {wc > 0 && <Text style={styles.cellDot}>●</Text>}
          {pr > 0 && (
            <View style={styles.trophyBadge}>
              <Trophy size={10} color={Void.accentText} />
              <Text style={styles.trophyNum}>{pr}</Text>
            </View>
          )}
        </View>
      );
    }
    const key = cell.key;
    const dayNum = cell.day!;
    const isToday = key === todayKey;
    const workoutCount = workoutDays[key] ?? 0;
    const prCount = prDays[key] ?? 0;
    const status = dayStatuses[key];
    const isPast = parseDateKey(key) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isSelected = selectedDate === key;

    let bg: string = Void.surface;
    let borderColor: string = Void.border;
    let textColor: string = Void.textSecondary;

    if (workoutCount > 0) {
      bg = 'rgba(204, 255, 0, 0.25)';
      borderColor = Void.accent;
      textColor = Void.text;
    } else if (status === 'rest') {
      bg = 'rgba(80, 140, 255, 0.25)';
      borderColor = 'rgba(80, 140, 255, 0.6)';
      textColor = '#6a9eff';
    } else if (status === 'missed') {
      bg = 'rgba(255, 80, 80, 0.20)';
      borderColor = 'rgba(255, 80, 80, 0.5)';
      textColor = '#ff6a6a';
    } else if (isPast) {
      bg = Void.surfaceRaised;
      borderColor = Void.border;
      textColor = Void.textTertiary;
    }

    return (
      <Pressable
        key={key}
        style={[
          styles.cell,
          { backgroundColor: bg, borderColor, height: cellHeight },
          isToday && styles.cellToday,
          isSelected && styles.cellSelected,
        ]}
        onPress={() => {
          if (workoutCount > 0) {
            void onDayPress(key);
          } else if (status) {
            onClearDayStatus(key);
          } else if (isPast) {
            onUnknownDayPress(key);
          } else {
            void onDayPress(key);
          }
        }}>
        <Text style={[styles.cellDay, { color: textColor }]}>{dayNum}</Text>
        {prCount > 0 && (
          <View style={styles.trophyBadge}>
            <Trophy size={10} color={Void.accentText} />
            <Text style={styles.trophyNum}>{prCount}</Text>
          </View>
        )}
        {workoutCount === 0 && !status && isPast && (
          <Text style={styles.unknownMark}>?</Text>
        )}
        {workoutCount > 0 && (
          <Text style={styles.cellDot}>●</Text>
        )}
      </Pressable>
    );
  };

  const renderEntryCard = (item: LogEntry) => {
    if (item.kind === 'cardio') {
      const meta = ACTIVITY_META[item.activity as keyof typeof ACTIVITY_META];
      const distU = distanceUnitFor(unit);
      return (
        <Pressable
          key={item.id}
          onPress={() => router.push('/cardio')}
          style={{ marginBottom: 10 }}>
          <Card>
            <View style={styles.entryTop}>
              <Text style={styles.entryTitle}>{meta?.label ?? item.activity}</Text>
              <View style={styles.feelBadge}>
                <Text style={styles.feelBadgeText}>CARDIO</Text>
              </View>
            </View>
            <Text style={styles.entryDate}>{formatDate(item.started_at)}</Text>
            <View style={styles.entryStats}>
              <Text style={styles.entryStat}>{formatDuration(item.duration_seconds)}</Text>
              {item.distance_m != null && item.distance_m > 0 && (
                <>
                  <Text style={styles.entryDot}>·</Text>
                  <Text style={styles.entryStat}>{formatDistance(item.distance_m, distU)}</Text>
                </>
              )}
              {item.avg_hr != null && (
                <>
                  <Text style={styles.entryDot}>·</Text>
                  <Text style={styles.entryStat}>{item.avg_hr} bpm</Text>
                </>
              )}
              {item.calories != null && (
                <>
                  <Text style={styles.entryDot}>·</Text>
                  <Text style={styles.entryStat}>{item.calories} kcal</Text>
                </>
              )}
            </View>
          </Card>
        </Pressable>
      );
    }
    return (
    <Pressable
      key={item.id}
      onPress={() => router.push(`/workout/${item.id}`)}
      style={{ marginBottom: 10 }}>
      <Card>
        <View style={styles.entryTop}>
          <Text style={styles.entryTitle}>{item.title}</Text>
          {item.feel != null && item.feel >= 1 && item.feel <= FEELS.length && (
            <View style={styles.feelBadge}>
              <Text style={styles.feelBadgeText}>{FEELS[item.feel - 1].toUpperCase()}</Text>
            </View>
          )}
          {item.pr_count > 0 && (
            <View style={styles.prBadge}>
              <Trophy size={11} color={Void.accentText} />
              <Text style={styles.prBadgeText}>{item.pr_count}</Text>
            </View>
          )}
        </View>
        <Text style={styles.entryDate}>{formatDate(item.started_at)}</Text>
        <View style={styles.entryStats}>
          <Text style={styles.entryStat}>
            {item.duration_seconds != null ? formatDuration(item.duration_seconds) : '-'}
          </Text>
          <Text style={styles.entryDot}>·</Text>
          <Text style={styles.entryStat}>
            {formatVolume(item.total_volume_kg, unit)} {unit}
          </Text>
          <Text style={styles.entryDot}>·</Text>
          <Text style={styles.entryStat}>
            {item.exercise_count} ex · {item.set_count} sets
          </Text>
        </View>
      </Card>
    </Pressable>
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="Logbook"
        right={
        <View style={styles.headerActions}>
          {viewMode === 'calendar' && (
            <Pressable
              style={styles.modeToggle}
              onPress={() => setCalMode((m) => m === 'month' ? 'day' : m === 'day' ? 'week' : 'month')}
              hitSlop={8}>
              <Text style={styles.modeToggleText}>
                {calMode === 'day' ? 'Day' : calMode === 'week' ? 'Week' : 'Month'}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.modeBtn, viewMode === 'calendar' && styles.modeBtnActive]}
            onPress={() => setViewMode('calendar')}
            hitSlop={8}>
            <Calendar size={16} color={viewMode === 'calendar' ? Void.accentText : Void.textSecondary} />
          </Pressable>
          <Pressable
            style={[styles.modeBtn, viewMode === 'list' && styles.modeBtnActive]}
            onPress={() => setViewMode('list')}
            hitSlop={8}>
            <List size={16} color={viewMode === 'list' ? Void.accentText : Void.textSecondary} />
          </Pressable>
          <Pressable onPress={() => void exportWorkoutsCsv()} hitSlop={8} style={styles.modeBtn}>
            <Download size={16} color={Void.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/workout/manual')}
            hitSlop={8}
            style={[styles.modeBtn, { backgroundColor: Void.accent }]}>
            <Plus size={16} color={Void.accentText} />
          </Pressable>
        </View>
        }
      />

      {viewMode === 'list' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}>
          {allEntries.length === 0 ? (
            <Text style={styles.empty}>Nothing logged yet.</Text>
          ) : (
            allEntries.map(renderEntryCard)
          )}
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Month/Week/Day navigation */}
          <View style={styles.monthNav}>
            <Pressable onPress={goPrev} hitSlop={8}>
              <ChevronLeft size={24} color={Void.text} />
            </Pressable>
            <Text style={styles.monthTitle}>{navTitle}</Text>
            <Pressable onPress={goNext} hitSlop={8}>
              <ChevronRight size={24} color={Void.text} />
            </Pressable>
          </View>

          {/* Day labels (hide in day mode) */}
          {calMode !== 'day' && (
            <View style={styles.dayLabels}>
              {DAY_LABELS.map((d, i) => (
                <Text key={i} style={[styles.dayLabel, { width: CELL_SIZE }]}>{d}</Text>
              ))}
            </View>
          )}

          {/* Calendar grid (month/week) or single day detail */}
          {calMode !== 'day' ? (
            <View style={styles.calendarGrid}>
              {cells.map(renderCell)}
            </View>
          ) : (
            <View style={styles.dayDetailCard}>
              <CardSheen radius={14} />
              {(() => {
                const key = dateKey(viewYear, viewMonth, viewDay);
                const workoutCount = workoutDays[key] ?? 0;
                const prCount = prDays[key] ?? 0;
                const status = dayStatuses[key];
                const isPast = parseDateKey(key) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                return (
                  <>
                    <View style={styles.dayDetailTop}>
                      <Text style={styles.dayDetailDate}>
                        {DAY_LABELS_FULL[(new Date(viewYear, viewMonth, viewDay).getDay() + 6) % 7]}{' '}
                        {viewDay} {MONTH_NAMES[viewMonth]} {viewYear}
                      </Text>
                      {prCount > 0 && (
                        <View style={styles.prBadge}>
                          <Trophy size={12} color={Void.accentText} />
                          <Text style={styles.prBadgeText}>{prCount} PR</Text>
                        </View>
                      )}
                    </View>
                    {workoutCount > 0 ? (
                      <Text style={styles.dayDetailStatus}>{workoutCount} session{workoutCount > 1 ? 's' : ''} · {status ?? 'trained'}</Text>
                    ) : status ? (
                      <Text style={[styles.dayDetailStatus, { color: status === 'rest' ? '#6a9eff' : '#ff6a6a' }]}>
                        {status === 'rest' ? 'Rest day' : 'Missed day'}
                      </Text>
                    ) : isPast ? (
                      <Pressable onPress={() => onUnknownDayPress(key)}>
                        <Text style={[styles.dayDetailStatus, { color: Void.accent }]}>Mark this day →</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.dayDetailStatus}>No workout yet</Text>
                    )}
                  </>
                );
              })()}
            </View>
          )}

          {/* Legend */}
          <View style={styles.legend}>
            <LegendDot color={Void.accent} label="Workout" />
            <LegendDot color="#6a9eff" label="Rest" />
            <LegendDot color="#ff6a6a" label="Missed" />
            <LegendDot color={Void.textTertiary} label="Unknown" />
          </View>

          {/* Selected day entries (month/week modes) */}
          {selectedDate && calMode !== 'day' && (
            <View style={styles.entriesSection}>
              <Text style={styles.entriesTitle}>{formatDate(selectedDate)}</Text>
              {dayEntries.length === 0 ? (
                <Text style={styles.entriesEmpty}>No sessions on this day.</Text>
              ) : (
                dayEntries.map(renderEntryCard)
              )}
            </View>
          )}

          {/* Day mode: always load entries for the displayed day; only render
              them once the loaded key matches so a previous day's rows can
              never flash under the new header. */}
          {calMode === 'day' && (
            <>
              <LoadDayEntries
                date={dateKey(viewYear, viewMonth, viewDay)}
                onLoad={onDayEntriesLoaded}
              />
              {selectedDate === dateKey(viewYear, viewMonth, viewDay) && dayEntries.length > 0 && (
                <View style={styles.entriesSection}>
                  {dayEntries.map(renderEntryCard)}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Unknown-day prompt: rest or missed */}
      <Sheet
        visible={dayPromptKey != null}
        onClose={() => setDayPromptKey(null)}
        title="MARK DAY">
        <Text style={styles.promptBody}>
          Nothing was logged on {dayPromptKey != null ? formatDate(dayPromptKey) : ''}. What happened?
        </Text>
        <View style={styles.promptActions}>
          <Pressable style={styles.promptBtn} onPress={() => markDay('rest')}>
            <Text style={styles.promptBtnText}>REST</Text>
          </Pressable>
          <Pressable style={styles.promptBtn} onPress={() => markDay('missed')}>
            <Text style={styles.promptBtnText}>MISSED</Text>
          </Pressable>
          <Pressable
            style={[styles.promptBtn, styles.promptBtnAccent]}
            onPress={() => setDayPromptKey(null)}>
            <Text style={[styles.promptBtnText, { color: Void.accentText }]}>CANCEL</Text>
          </Pressable>
        </View>
      </Sheet>
    </Screen>
  );
}

/** Side-effect-only loader: fetches a day's entries and hands them up with
 *  the key they were loaded for. */
function LoadDayEntries({ date, onLoad }: { date: string; onLoad: (date: string, e: LogEntry[]) => void }) {
  useEffect(() => {
    void listDayLog(date).then((e) => onLoad(date, e));
  }, [date, onLoad]);
  return null;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 6 },
  modeBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Void.surface,
  },
  modeBtnActive: { backgroundColor: Void.accent },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  monthTitle: { color: Void.text, fontSize: 20, fontWeight: '800' },

  modeToggle: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
    backgroundColor: Void.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleText: { color: Void.accent, fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },

  dayLabels: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 6,
    gap: GAP,
  },
  dayLabel: { color: Void.textTertiary, fontSize: 12, fontWeight: '700', textAlign: 'center' },

  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: GAP,
  },
  cell: {
    width: CELL_SIZE,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellBlank: { borderWidth: 0, backgroundColor: 'transparent' },
  cellToday: { borderWidth: 2, borderColor: Void.accent },
  cellSelected: { borderWidth: 2, borderColor: Void.text },
  cellDay: { fontSize: 16, fontWeight: '700', ...tabular },
  cellDot: { color: Void.accent, fontSize: 8, position: 'absolute', bottom: 4 },
  trophyBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Void.accent,
    borderRadius: 7,
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 2,
  },
  trophyNum: { color: Void.accentText, fontSize: 9, fontWeight: '800', ...tabular },
  unknownMark: {
    position: 'absolute',
    bottom: 3,
    color: Void.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },

  dayDetailCard: {
    marginHorizontal: 16,
    ...cardChrome,
    borderRadius: 14,
    padding: 20,
  },
  dayDetailTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayDetailDate: { color: Void.text, fontSize: 18, fontWeight: '700', flex: 1 },
  dayDetailStatus: { color: Void.textSecondary, fontSize: 14, marginTop: 8 },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: Void.textTertiary, fontSize: 11 },

  entriesSection: { paddingHorizontal: 16, paddingTop: 4 },
  entriesTitle: { color: Void.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  entriesEmpty: { color: Void.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 16 },

  empty: { color: Void.textTertiary, fontSize: 14, textAlign: 'center', paddingVertical: 40 },

  entryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryTitle: { color: Void.text, fontSize: 16, fontWeight: '700', flex: 1 },
  entryDate: { color: Void.textTertiary, fontSize: 12, marginTop: 2 },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Void.accent,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  feelBadge: {
    borderWidth: 1,
    borderColor: '#FFB800',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  feelBadgeText: { color: '#FFB800', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  prBadgeText: { color: Void.accentText, fontSize: 10, fontWeight: '800' },
  entryStats: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  entryStat: { color: Void.textSecondary, fontSize: 13, ...tabular },
  entryDot: { color: Void.textTertiary },

  promptBody: { color: Void.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  promptActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  promptBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  promptBtnAccent: { backgroundColor: Void.accent },
  promptBtnText: { color: Void.textSecondary, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
