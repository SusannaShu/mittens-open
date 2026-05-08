/**
 * ActivityTimeInputs -- Start time, End time, and Duration inputs.
 * Bidirectional: changing duration updates end time display,
 * changing end time updates duration.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../lib/theme';
import { activityEditStyles as s } from './activityEditStyles';

interface Props {
  loggedAt: Date;
  setLoggedAt: (d: Date) => void;
  durationMin: string;
  setDurationMin: (v: string) => void;
}

/** Convert a Date to 12h display fields */
function to12h(d: Date) {
  const h = d.getHours();
  return {
    hour: String(h === 0 ? 12 : h > 12 ? h - 12 : h),
    minute: String(d.getMinutes()).padStart(2, '0'),
    ampm: (h >= 12 ? 'PM' : 'AM') as 'AM' | 'PM',
  };
}

/** Parse 12h fields back into a 24h hour */
function parse24h(hour: string, minute: string, ampm: 'AM' | 'PM'): { h: number; m: number } | null {
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (isNaN(h) || h < 1 || h > 12 || isNaN(m) || m < 0 || m > 59) return null;
  let hour24 = h === 12 ? 0 : h;
  if (ampm === 'PM') hour24 += 12;
  return { h: hour24, m };
}

export default function ActivityTimeInputs({ loggedAt, setLoggedAt, durationMin, setDurationMin }: Props) {
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Start time edit fields
  const startFields = to12h(loggedAt);
  const [editHour, setEditHour] = useState(startFields.hour);
  const [editMinute, setEditMinute] = useState(startFields.minute);
  const [editAmPm, setEditAmPm] = useState(startFields.ampm);

  // End time edit fields
  const endDate = new Date(loggedAt.getTime() + (parseInt(durationMin, 10) || 0) * 60000);
  const endFields = to12h(endDate);
  const [editEndHour, setEditEndHour] = useState(endFields.hour);
  const [editEndMinute, setEditEndMinute] = useState(endFields.minute);
  const [editEndAmPm, setEditEndAmPm] = useState(endFields.ampm);

  // Sync edit fields when parent data changes (e.g. on open)
  React.useEffect(() => {
    const sf = to12h(loggedAt);
    setEditHour(sf.hour);
    setEditMinute(sf.minute);
    setEditAmPm(sf.ampm);

    const dur = parseInt(durationMin, 10) || 0;
    const ed = new Date(loggedAt.getTime() + dur * 60000);
    const ef = to12h(ed);
    setEditEndHour(ef.hour);
    setEditEndMinute(ef.minute);
    setEditEndAmPm(ef.ampm);
  }, [loggedAt, durationMin]);

  const applyStartTime = () => {
    const parsed = parse24h(editHour, editMinute, editAmPm);
    if (!parsed) return;
    const newDate = new Date(loggedAt);
    newDate.setHours(parsed.h, parsed.m);
    setLoggedAt(newDate);
    setShowStartPicker(false);
  };

  const applyEndTime = () => {
    const parsed = parse24h(editEndHour, editEndMinute, editEndAmPm);
    if (!parsed) return;
    const newEnd = new Date(loggedAt);
    newEnd.setHours(parsed.h, parsed.m);
    if (newEnd < loggedAt) newEnd.setDate(newEnd.getDate() + 1);
    const diffMin = Math.round((newEnd.getTime() - loggedAt.getTime()) / 60000);
    setDurationMin(String(Math.max(1, diffMin)));
    setShowEndPicker(false);
  };

  // Display strings
  const now = new Date();
  const isToday = loggedAt.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = loggedAt.toDateString() === yesterday.toDateString();
  const dateLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : loggedAt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const startStr = loggedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const dur = parseInt(durationMin, 10) || 0;
  const computedEnd = new Date(loggedAt.getTime() + dur * 60000);
  const endStr = computedEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const isFutureDate = () => {
    const next = new Date(loggedAt);
    next.setDate(next.getDate() + 1);
    const now = new Date();
    // allow if tomorrow constitutes future but check logically
    return next > now;
  };

  return (
    <View>
      {/* Date Field */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text style={[s.label, { marginTop: 0 }]}>Date</Text>
        <View style={s.dateSelectorRail}>
          <TouchableOpacity
            style={s.dateSelectBtn}
            onPress={() => {
              const prev = new Date(loggedAt);
              prev.setDate(prev.getDate() - 1);
              setLoggedAt(prev);
            }}
            activeOpacity={0.6}
          >
            <Feather name="chevron-left" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.dateSelectorText}>{dateLabel}</Text>
          <TouchableOpacity
            style={s.dateSelectBtn}
            onPress={() => {
              const next = new Date(loggedAt);
              next.setDate(next.getDate() + 1);
              if (next <= new Date()) setLoggedAt(next);
            }}
            activeOpacity={0.6}
          >
            <Feather name="chevron-right" size={18} color={isFutureDate() ? colors.border : colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Three-column grid: Start | Duration | End */}
      <View style={[s.timeGrid, { marginTop: spacing.xs }]}>
        {/* Start Time */}
        <View style={s.timeGridCol}>
          <Text style={[s.label, { marginTop: 0 }]}>Start</Text>
          <TouchableOpacity
            style={s.timeGridButton}
            onPress={() => { setShowStartPicker(!showStartPicker); setShowEndPicker(false); }}
            activeOpacity={0.6}
          >
            <Text style={s.timeGridButtonText}>{startStr}</Text>
          </TouchableOpacity>
        </View>

        {/* Duration */}
        <View style={{ width: 64 }}>
          <Text style={[s.label, { marginTop: 0 }]}>Min</Text>
          <TextInput
            style={s.durationInput}
            value={durationMin}
            onChangeText={setDurationMin}
            keyboardType="numeric"
            placeholder="30"
            placeholderTextColor={colors.textMuted}
          />
        </View>

        {/* End Time */}
        <View style={s.timeGridCol}>
          <Text style={[s.label, { marginTop: 0 }]}>End</Text>
          <TouchableOpacity
            style={s.timeGridButton}
            onPress={() => { setShowEndPicker(!showEndPicker); setShowStartPicker(false); }}
            activeOpacity={0.6}
          >
            <Text style={s.timeGridButtonText}>{endStr}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Start Time Picker */}
      {showStartPicker && (
        <View style={s.timePicker}>

          {/* Time inputs */}
          <TimeInputRow
            hour={editHour} setHour={setEditHour}
            minute={editMinute} setMinute={setEditMinute}
            ampm={editAmPm} setAmPm={setEditAmPm}
            onApply={applyStartTime}
          />
          <TimeOptionsDropdown
            baseDate={loggedAt}
            onSelect={(d) => {
              setLoggedAt(d);
              setShowStartPicker(false);
            }}
          />
        </View>
      )}

      {/* End Time Picker */}
      {showEndPicker && (
        <View style={s.timePicker}>
          <TimeInputRow
            hour={editEndHour} setHour={setEditEndHour}
            minute={editEndMinute} setMinute={setEditEndMinute}
            ampm={editEndAmPm} setAmPm={setEditEndAmPm}
            onApply={applyEndTime}
          />
          <TimeOptionsDropdown
            baseDate={computedEnd}
            referenceStart={loggedAt}
            onSelect={(d) => {
              if (d < loggedAt) d.setDate(d.getDate() + 1);
              const diffMin = Math.round((d.getTime() - loggedAt.getTime()) / 60000);
              setDurationMin(String(Math.max(1, diffMin)));
              setShowEndPicker(false);
            }}
          />
        </View>
      )}
    </View>
  );
}

/** Reusable hour:minute AM/PM row with apply button */
function TimeInputRow({ hour, setHour, minute, setMinute, ampm, setAmPm, onApply }: {
  hour: string; setHour: (v: string) => void;
  minute: string; setMinute: (v: string) => void;
  ampm: 'AM' | 'PM'; setAmPm: (v: 'AM' | 'PM') => void;
  onApply: () => void;
}) {
  return (
    <View style={s.timeRow}>
      <TextInput
        style={s.timeInput}
        value={hour}
        onChangeText={setHour}
        keyboardType="number-pad"
        maxLength={2}
        placeholder="12"
        placeholderTextColor={colors.textMuted}
        selectTextOnFocus
      />
      <Text style={s.timeColon}>:</Text>
      <TextInput
        style={s.timeInput}
        value={minute}
        onChangeText={setMinute}
        keyboardType="number-pad"
        maxLength={2}
        placeholder="00"
        placeholderTextColor={colors.textMuted}
        selectTextOnFocus
      />
      <View style={s.ampmRow}>
        <TouchableOpacity
          style={[s.ampmBtn, ampm === 'AM' && s.ampmBtnActive]}
          onPress={() => setAmPm('AM')}
          activeOpacity={0.6}
        >
          <Text style={[s.ampmText, ampm === 'AM' && s.ampmTextActive]}>AM</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.ampmBtn, ampm === 'PM' && s.ampmBtnActive]}
          onPress={() => setAmPm('PM')}
          activeOpacity={0.6}
        >
          <Text style={[s.ampmText, ampm === 'PM' && s.ampmTextActive]}>PM</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={s.timeApplyBtn} onPress={onApply} activeOpacity={0.6}>
        <Feather name="check" size={16} color={colors.bg} />
      </TouchableOpacity>
    </View>
  );
}

/** Vertical dropdown of times (15m intervals) mimicking Google Calendar */
function TimeOptionsDropdown({ baseDate, referenceStart, onSelect }: { baseDate: Date; referenceStart?: Date; onSelect: (d: Date) => void }) {
  const options = [];
  const startOfDay = new Date(baseDate);
  startOfDay.setHours(0, 0, 0, 0);

  // If selecting end time, constrain start index so we don't show past times easily
  // but for simplicity we show all 96
  for (let i = 0; i < 24 * 4; i++) {
    const d = new Date(startOfDay.getTime() + i * 15 * 60000);
    options.push(d);
  }

  const scrollRef = React.useRef<any>(null);

  React.useEffect(() => {
    const mins = baseDate.getHours() * 60 + baseDate.getMinutes();
    const index = Math.floor(mins / 15);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, (index - 2) * 44), animated: false });
    }, 50);
  }, [baseDate]);

  return (
    <View style={{ marginTop: 12, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, overflow: 'hidden', backgroundColor: '#FFF' }}>
      <ScrollView ref={scrollRef} style={{ maxHeight: 150 }} nestedScrollEnabled>
        {options.map((d, i) => {
          let extraLabel = '';
          if (referenceStart) {
            let diff = Math.round((d.getTime() - referenceStart.getTime()) / 60000);
            if (diff <= 0) diff += 24 * 60; // Next day
            const h = Math.floor(diff / 60);
            const m = diff % 60;
            extraLabel = ` (${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm' : ''})`.trimEnd();
            if (h === 0 && m === 0) extraLabel = '';
            else if (h === 0) extraLabel = ` (${m}m)`;
          }

          return (
            <TouchableOpacity
              key={i}
              style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingVertical: 12, paddingHorizontal: 16,
                borderBottomWidth: i === options.length - 1 ? 0 : 1, borderBottomColor: '#F0F0F0',
              }}
              onPress={() => onSelect(d)}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 14, color: '#000', fontWeight: '500' }}>
                {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
              {extraLabel ? <Text style={{ fontSize: 13, color: '#888' }}>{extraLabel}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
