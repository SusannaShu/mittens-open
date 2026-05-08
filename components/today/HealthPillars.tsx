import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Pressable, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { PillarContributor } from '../../lib/services/activityApi';
import { getCitation, getCitationDOIUrl } from '../../lib/citations';

interface PillarData {
  id: string;
  name: string;
  value: number; // 0-100 score
  target: string;
  metric: string;
  status: 'good' | 'moderate' | 'low';
  details: { label: string; val: string }[];
  whyText: string;
}

interface ExpandableProps {
  pillars: PillarData[];
  pillarContributors?: Record<string, PillarContributor[]>;
  onAskMittens?: (prompt: string) => void;
}

export function HealthPillarsExpandable({ pillars, pillarContributors, onAskMittens }: ExpandableProps) {
  const [selectedPillar, setSelectedPillar] = useState<PillarData | null>(null);

  const renderStatus = (status: string) => {
    switch (status) {
      case 'good': return <View style={[styles.statusDot, { backgroundColor: colors.statusGood }]} />;
      case 'moderate': return <View style={[styles.statusDot, { backgroundColor: colors.statusModerate }]} />;
      case 'low': return <View style={[styles.statusDot, { backgroundColor: colors.statusLow }]} />;
      default: return null;
    }
  };

  if (!pillars || pillars.length === 0) return null;

  return (
    <View style={styles.container}>
      {pillars.map(p => (
        <TouchableOpacity
          key={p.id}
          style={styles.pillarRow}
          onPress={() => setSelectedPillar(p)}
          activeOpacity={0.6}
        >
          {renderStatus(p.status)}
          <Text style={styles.pillarName}>{p.name}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${p.value}%`, backgroundColor: colors.textPrimary }]} />
          </View>
          <Text style={styles.pillarMetric}>{p.value}%</Text>
        </TouchableOpacity>
      ))}

      <HealthPillarModal
        pillar={selectedPillar}
        contributors={selectedPillar ? (pillarContributors?.[selectedPillar.id] || []) : []}
        onClose={() => setSelectedPillar(null)}
        onAskMittens={onAskMittens}
      />
    </View>
  );
}

function HealthPillarModal({ pillar, contributors, onClose, onAskMittens }: {
  pillar: PillarData | null;
  contributors: PillarContributor[];
  onClose: () => void;
  onAskMittens?: (prompt: string) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [expandedCitation, setExpandedCitation] = useState<number | null>(null);

  if (!pillar) return null;

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBg} onPress={onClose} />
        <View style={styles.modalContent}>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{pillar.name}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Feather name="x" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.mainScoreWrapper}>
              <Text style={styles.mainScore}>{pillar.value}%</Text>
              <Text style={styles.mainTarget}>Target: {pillar.target}</Text>
            </View>

            <View style={styles.detailsGrid}>
              {pillar.details.map((d, i) => (
                <View key={i} style={styles.detailBox}>
                  <Text style={styles.detailLabel}>{d.label}</Text>
                  <Text style={styles.detailVal}>{d.val}</Text>
                </View>
              ))}
            </View>

            {/* Contributing Logs */}
            {contributors.length > 0 && (
              <View style={styles.contributorsSection}>
                <Text style={styles.contributorsTitle}>CONTRIBUTING LOGS</Text>
                {contributors.map((c, i) => {
                  const d = new Date(c.loggedAt);
                  const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const deltaStr = c.delta > 0 ? `+${c.delta}` : c.delta === 0 ? '--' : `${c.delta}`;
                  const unitStr = c.unit === 'minutes' ? 'm' : c.unit === 'session' ? ' sess' : c.unit === 'hours' ? 'h' : '';
                  const citation = getCitation(c.citationKey);
                  const isExpanded = expandedCitation === i;

                  return (
                    <View key={`${c.activityId}-${i}`} style={styles.contributorRow}>
                      <View style={styles.contributorHeader}>
                        <Text style={styles.contributorDate}>{dateLabel}</Text>
                        <Text style={styles.contributorName} numberOfLines={1}>{c.logName}</Text>
                        <Text style={[
                          styles.contributorDelta,
                          c.delta > 0 && { color: colors.statusGood },
                          c.delta < 0 && { color: colors.textMuted },
                        ]}>
                          {deltaStr}{unitStr}
                        </Text>
                      </View>
                      <Text style={styles.contributorReason} numberOfLines={2}>{c.reason}</Text>
                      {citation && (
                        <TouchableOpacity
                          style={styles.contributorCitationBtn}
                          onPress={() => setExpandedCitation(isExpanded ? null : i)}
                          activeOpacity={0.6}
                        >
                          <Feather name="info" size={9} color={colors.textMuted} />
                          <Text style={styles.contributorCitationSource}>{citation.source}</Text>
                        </TouchableOpacity>
                      )}
                      {isExpanded && citation && (
                        <View style={styles.contributorCitationBox}>
                          <Text style={styles.citationClaim}>{citation.claim}</Text>
                          <Text style={styles.citationJournal}>{citation.journal}</Text>
                          {citation.doi && (
                            <TouchableOpacity onPress={() => {
                              const url = getCitationDOIUrl(citation.doi);
                              if (url) Linking.openURL(url);
                            }}>
                              <Text style={styles.citationDoi}>doi: {citation.doi}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.whySection}>
              <TouchableOpacity
                style={styles.whyHeader}
                onPress={() => setShowWhy(!showWhy)}
                activeOpacity={0.7}
              >
                <Text style={styles.whyTitle}>{showWhy ? '[-]' : '[+]'} Why this matters</Text>
              </TouchableOpacity>
              {showWhy && (
                <Text style={styles.whyBody}>{pillar.whyText}</Text>
              )}
            </View>

            {onAskMittens && (
              <TouchableOpacity
                style={styles.askBtn}
                onPress={() => {
                  onAskMittens(
                    `Explain my ${pillar.name} pillar score (${pillar.value}%). ` +
                    `Target is ${pillar.target}. ` +
                    `What specifically contributed to this score and what can I do to improve it? Cite the research.`
                  );
                  onClose();
                }}
                activeOpacity={0.6}
              >
                <Feather name="message-circle" size={13} color={colors.textPrimary} />
                <Text style={styles.askBtnText}>Ask Mittens why</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingLeft: spacing.md,
    marginTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  pillarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  pillarName: {
    width: 130,
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  track: {
    flex: 1,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  pillarMetric: {
    width: 40,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'right',
  },
  
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  modalContent: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainScoreWrapper: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: '#FAFAFA',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  mainScore: {
    fontFamily: fonts.heading,
    fontSize: 36,
    color: colors.textPrimary,
  },
  mainTarget: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  detailsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  detailBox: {
    flex: 1,
    padding: spacing.md,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.md,
  },
  detailLabel: {
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 4,
  },
  detailVal: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  whySection: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  whyHeader: {
    paddingVertical: spacing.sm,
  },
  whyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  whyBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },

  // Contributing logs
  contributorsSection: {
    marginBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  contributorsTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  contributorRow: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  contributorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contributorDate: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    width: 50,
  },
  contributorName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  contributorDelta: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 40,
    textAlign: 'right',
  },
  contributorReason: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 14,
  },
  contributorCitationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  contributorCitationSource: {
    fontSize: 9,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  contributorCitationBox: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
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

  // Ask Mittens
  askBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  askBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
