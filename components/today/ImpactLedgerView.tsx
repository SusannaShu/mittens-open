/**
 * ImpactLedgerView -- Auditable breakdown of how an activity affects life balance + health pillars.
 * Shows lifeCategory weights with reasons, health pillar deltas with citations,
 * and nutrient impacts with explanations.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../lib/theme';
import { ImpactLedger } from '../../lib/services/activityApi';
import { getCitation, getCitationDOIUrl } from '../../lib/citations';

interface Props {
  ledger: ImpactLedger | null | undefined;
  onAskMittens?: (prompt: string) => void;
  activityName?: string;
}

const PILLAR_LABELS: Record<string, string> = {
  nutrition: 'Nutrition',
  movement: 'Movement',
  sleep: 'Sleep',
  gut: 'Gut Health',
  nature: 'Touch Grass',
  circadian: 'Circadian',
  brain: 'Brain Hygiene',
};

const CATEGORY_ICONS: Record<string, string> = {
  work: 'monitor',
  health: 'heart',
  play: 'star',
  love: 'users',
};

export default function ImpactLedgerView({ ledger, onAskMittens, activityName }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);

  if (!ledger) return null;

  const hasLifeCategories = ledger.lifeCategories && Object.keys(ledger.lifeCategories).length > 0;
  const hasPillars = ledger.healthPillars && ledger.healthPillars.length > 0;
  const hasNutrients = ledger.nutrientImpact && Object.keys(ledger.nutrientImpact).length > 0;

  if (!hasLifeCategories && !hasPillars && !hasNutrients) return null;

  return (
    <View style={s.container}>
      <TouchableOpacity
        style={s.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.6}
      >
        <View style={s.headerLeft}>
          <Feather name="bar-chart-2" size={13} color={colors.textPrimary} />
          <Text style={s.headerText}>IMPACT BREAKDOWN</Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={s.content}>
          {/* Life Balance weights */}
          {hasLifeCategories && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>LIFE BALANCE</Text>
              {Object.entries(ledger.lifeCategories!)
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, weight]) => (
                  <View key={cat} style={s.row}>
                    <View style={s.rowLeft}>
                      <Feather
                        name={(CATEGORY_ICONS[cat] || 'circle') as any}
                        size={12}
                        color={colors.textSecondary}
                      />
                      <Text style={s.rowLabel}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </View>
                    <Text style={s.rowValue}>{Math.round(weight * 100)}%</Text>
                    {ledger.lifeCategoryReasons?.[cat] && (
                      <Text style={s.rowReason} numberOfLines={2}>
                        {ledger.lifeCategoryReasons[cat]}
                      </Text>
                    )}
                  </View>
                ))}
            </View>
          )}

          {/* Health Pillar deltas */}
          {hasPillars && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>HEALTH PILLARS</Text>
              {ledger.healthPillars!.map((hp, idx) => {
                const citation = getCitation(hp.citationKey);
                const isExpCitation = expandedCitation === `${hp.pillarId}-${idx}`;
                const deltaStr =
                  hp.delta > 0
                    ? `+${hp.delta}`
                    : hp.delta === 0
                    ? '--'
                    : `${hp.delta}`;

                return (
                  <View key={`${hp.pillarId}-${idx}`}>
                    <View style={s.row}>
                      <Text style={s.rowLabel}>
                        {PILLAR_LABELS[hp.pillarId] || hp.pillarId}
                      </Text>
                      <Text
                        style={[
                          s.rowValue,
                          hp.delta > 0 && s.positive,
                          hp.delta < 0 && s.negative,
                        ]}
                      >
                        {deltaStr}
                        {hp.unit === 'minutes' ? 'm' : hp.unit === 'session' ? ' sess' : ''}
                      </Text>
                    </View>
                    <Text style={s.rowReason} numberOfLines={2}>{hp.reason}</Text>
                    {citation && (
                      <TouchableOpacity
                        style={s.citationBtn}
                        onPress={() =>
                          setExpandedCitation(isExpCitation ? null : `${hp.pillarId}-${idx}`)
                        }
                        activeOpacity={0.6}
                      >
                        <Feather name="info" size={10} color={colors.textMuted} />
                        <Text style={s.citationSource}>{citation.source}</Text>
                      </TouchableOpacity>
                    )}
                    {isExpCitation && citation && (
                      <View style={s.citationBox}>
                        <Text style={s.citationClaim}>{citation.claim}</Text>
                        <Text style={s.citationJournal}>{citation.journal}</Text>
                        {citation.doi && (
                          <TouchableOpacity
                            onPress={() => {
                              const url = getCitationDOIUrl(citation.doi);
                              if (url) Linking.openURL(url);
                            }}
                          >
                            <Text style={s.citationDoi}>doi: {citation.doi}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Nutrient Impact */}
          {hasNutrients && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>METABOLIC IMPACT</Text>
              {Object.entries(ledger.nutrientImpact!)
                .filter(([, v]) => v !== 0)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([key, val]) => (
                  <View key={key} style={s.row}>
                    <Text style={s.rowLabel}>
                      {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                    <Text style={[s.rowValue, val > 0 ? s.positive : s.negative]}>
                      {val > 0 ? '+' : ''}
                      {Math.round(val * 10) / 10}
                    </Text>
                    {ledger.nutrientReasons?.[key] && (
                      <Text style={s.rowReason} numberOfLines={2}>
                        {ledger.nutrientReasons[key]}
                      </Text>
                    )}
                  </View>
                ))}
              {ledger.mets && (
                <View style={s.row}>
                  <Text style={s.rowLabel}>METs</Text>
                  <Text style={s.rowValue}>{ledger.mets}</Text>
                  {ledger.metsSource && (
                    <Text style={s.rowReason}>{ledger.metsSource}</Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Ask Mittens */}
          {onAskMittens && (
            <TouchableOpacity
              style={s.askBtn}
              onPress={() =>
                onAskMittens(
                  `Explain the impact breakdown for "${activityName || 'this activity'}". ` +
                    `Why were the health pillar scores assigned this way? Cite the research.`
                )
              }
              activeOpacity={0.6}
            >
              <Feather name="message-circle" size={12} color={colors.textPrimary} />
              <Text style={s.askBtnText}>Ask Mittens why</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
  },
  content: {
    marginTop: spacing.sm,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 6,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    minWidth: 80,
  },
  rowValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 40,
  },
  positive: {
    color: colors.statusGood,
  },
  negative: {
    color: colors.textMuted,
  },
  rowReason: {
    fontSize: 10,
    color: colors.textMuted,
    width: '100%',
    marginTop: 1,
    lineHeight: 14,
  },
  citationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    marginBottom: 4,
  },
  citationSource: {
    fontSize: 9,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  citationBox: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  citationClaim: {
    fontSize: 10,
    color: colors.textSecondary,
    lineHeight: 14,
    marginBottom: 4,
  },
  citationJournal: {
    fontSize: 9,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  citationDoi: {
    fontSize: 9,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  askBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  askBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
