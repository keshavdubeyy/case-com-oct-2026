"use client"

import { Badge } from "@/components/ui/badge"
import { ChartCard } from "@/components/dashboard/chart-card"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { useDashboardData } from "@/components/filters/dashboard-data-provider"
import { CountBarChart } from "@/components/charts/count-bar-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/** Static findings from DATA_AUDIT.md — computed once during Phase 1 from the
 * raw CSVs, which are never shipped to the browser. These don't change with
 * the filter bar (this page doesn't use one) and aren't recomputable
 * client-side, so they're hand-transcribed here rather than derived from
 * dataQuality.json. */
const ROW_COUNTS_STATIC: { file: string; grain: string }[] = [
  { file: "patient_360_reference.csv", grain: "1 row / canonical patient" },
  { file: "teleconsultations.csv", grain: "1 row / episode (teleconsult_id = episode's origin event)" },
  { file: "ncd_screening.csv", grain: "1 row / NCD screening encounter (own source system)" },
  { file: "prescriptions.csv", grain: "1 row / prescribed medicine line" },
  { file: "medicine_dispensing.csv", grain: "1 row / dispensing attempt" },
  { file: "medicine_stock_status.csv", grain: "1 row / facility × medicine × month" },
  { file: "lab_tests.csv", grain: "1 row / lab order (own source system)" },
  { file: "followup_visits.csv", grain: "1 row / follow-up review visit" },
  { file: "visit_history.csv", grain: "1 row / any encounter (teleconsults + follow-ups + NCD follow-up + screening + OPD)" },
  { file: "outreach_actions.csv", grain: "1 row / ASHA/CHO outreach attempt" },
  { file: "facility_reference.csv", grain: "1 row / facility" },
  { file: "geography_reference.csv", grain: "1 row / village" },
  { file: "episode_outcomes.csv", grain: "1 row / episode — the label table" },
]

const SOURCE_ID_CARDINALITY: { file: string; idColumn: string; rows: number; distinctIds: number; rowsPerId: number }[] = [
  { file: "teleconsultations.csv", idColumn: "tele_source_patient_id", rows: 5516, distinctIds: 4231, rowsPerId: 1.3 },
  { file: "ncd_screening.csv", idColumn: "ncd_source_patient_id", rows: 4748, distinctIds: 3589, rowsPerId: 1.32 },
  { file: "prescriptions.csv", idColumn: "rx_source_patient_id", rows: 5151, distinctIds: 3449, rowsPerId: 1.49 },
  { file: "medicine_dispensing.csv", idColumn: "pharm_source_patient_id", rows: 3756, distinctIds: 2781, rowsPerId: 1.35 },
  { file: "lab_tests.csv", idColumn: "lab_source_patient_id", rows: 2005, distinctIds: 1814, rowsPerId: 1.11 },
  { file: "followup_visits.csv", idColumn: "visit_source_patient_id", rows: 2575, distinctIds: 2270, rowsPerId: 1.13 },
  { file: "visit_history.csv", idColumn: "visit_source_patient_id", rows: 13061, distinctIds: 4747, rowsPerId: 2.75 },
  { file: "outreach_actions.csv", idColumn: "outreach_source_patient_id", rows: 6088, distinctIds: 2705, rowsPerId: 2.25 },
]

const FINDINGS: { field: string; finding: string }[] = [
  {
    field: "known_ncd_status (patient_360)",
    finding: "Null 42.7% — this is a legitimate \"no known condition,\" not missing data. Must not be treated as a data-quality defect.",
  },
  {
    field: "mobile (all operational tables)",
    finding: "Null ~7–8%, consistently across every table with a mobile column — likely a simulated missingness process, relevant to outreach contactability analysis.",
  },
  {
    field: "review_due_days (teleconsultations)",
    finding: "Null 31.96%, exactly matching the review_advised = 'No' count (1,763) — a clean eligibility signal, not missing data.",
  },
  {
    field: "ncd_status / control_status / next_followup_due (ncd_screening)",
    finding: "Null ~20.4% together — tracks screenings where no NCD was found (control_status = 'Not diagnosed', 970 rows), not corruption.",
  },
  {
    field: "sample_date / result_date / result_flag (lab_tests)",
    finding: "Null 25.59%, matching test_status = 'Ordered-not-completed' (513 rows) — the intended \"not completed\" signal. test_status is the authoritative flag, not date-null inference.",
  },
  {
    field: "medicine_dispensing coverage",
    finding: "978 of 4,209 prescriptions (23%) have zero dispensing rows — true non-attempts. Counted as incomplete medicine access, never silently excluded from the denominator.",
  },
  {
    field: "geography_reference.road_access",
    finding: "Long tail: Paved 14, Mixed 12, Mostly paved 9, Poor 1 village. Any road-access breakdown must show the denominator so the 1-village \"Poor\" group isn't visually equated with the 14-village \"Paved\" group.",
  },
  {
    field: "Village free-text noise",
    finding: "113 distinct village strings across operational tables map down to 36 canonical villages — a real linkage task (confirmed genuine misspellings, not just casing), not something cleanable by lowercasing alone.",
  },
  {
    field: "Duplicate records",
    finding: "Zero fully-duplicated rows found across all 13 files.",
  },
  {
    field: "medicine_access_classification (fixed, see P1_FIXES.md)",
    finding:
      "A per-medicine dispensing-coverage bug (found by a fixture test while building the automated test suite) let a multi-medicine prescription count as 'fully dispensed' if only ONE of its medicines ever had a dispensing row, as long as that one row said 'Dispensed'. Affected 209 of 4,209 prescriptions (5.0%). Fixed in scripts/build_processed.py::classify_medicine_access() — Medicine Fulfillment Rate corrected from 59.85% to 54.88%; Dispensing Success Rate from 77.96% to 71.49%.",
  },
]

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  )
}

export default function DataQualityPage() {
  const { loading, error, dataQuality, labLinkageDiagnostics } = useDashboardData()

  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load processed data: {error}</div>
  }

  if (loading || !dataQuality) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const rowCountEntries = Object.entries(dataQuality.row_counts)
  const linkagePctData = dataQuality.linkage_stats.map((s) => ({
    label: s.source_system,
    value: Math.round(s.linked_pct * 1000) / 10,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Data Quality & Record Linkage"
        description="How trustworthy is this dashboard's data, and how were records from different systems tied to the same patient? This page is the single reference for that method — every confidence badge elsewhere on the dashboard links back here instead of re-explaining it."
      />

      {/* 1. Record counts by dataset */}
      <ChartCard
        title="Record counts by dataset"
        description="Every processed source file, as loaded by the dashboard's data pipeline"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead>Grain</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowCountEntries.map(([file, count]) => {
              const meta = ROW_COUNTS_STATIC.find((r) => r.file === file)
              return (
                <TableRow key={file}>
                  <TableCell className="font-mono text-xs">{file}</TableCell>
                  <TableCell className="text-right tabular-nums">{count.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-normal">{meta?.grain ?? "—"}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ChartCard>

      {/* 2. Linkage method, in prose */}
      <ChartCard title="How patient records get linked across systems" description="Plain-language explanation of the linkage method used everywhere on this dashboard">
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
          <p>
            <code className="text-xs">patient_360_reference.csv</code> is the only canonical patient table — 5,000 unique
            people. Every other operational table (teleconsultations, prescriptions, dispensing, lab tests, NCD screening,
            follow-up visits, outreach actions, visit history) instead carries its own source-system-local patient ID, with
            no crosswalk supplied to the canonical table. None of those IDs can be assumed equal to the canonical
            <code className="text-xs"> patient_id</code>, nor equal to each other across files.
          </p>
          <p>
            To resolve a source record to a canonical patient, the pipeline scores every plausible candidate on four
            signals, weighted by how much each one narrows things down: <strong>45% name similarity</strong> (typo- and
            word-order-tolerant string matching), <strong>25% mobile number match</strong> (only the last 4 digits are
            available on either side), <strong>15% village match</strong>, and <strong>15% age closeness</strong>. When a
            record is missing one of these signals (for example, mobile is null), the remaining weights are rescaled so
            they still add up to 100% — a missing field never silently counts as a mismatch.
          </p>
          <p>
            A match is only ever accepted with real confidence. Scoring <strong>0.72 or above</strong> is treated as{" "}
            <Badge variant="default">high</Badge> confidence and auto-linked. Scoring between <strong>0.55 and 0.72</strong> is{" "}
            <Badge variant="secondary">medium</Badge> confidence — linked, but flagged as lower-certainty everywhere it's
            used. Below 0.55 the record is left <Badge variant="destructive">unmatched</Badge> rather than forced onto a
            best guess. And if the top two candidate matches are within 0.03 of each other — too close to call — the
            record is downgraded to <Badge variant="outline">ambiguous</Badge> and also left unmatched, regardless of how
            high the raw score was.
          </p>
          <p>
            The system never guesses a match it isn&apos;t confident about. That means some patient-level rollups (history,
            NCD status, lab results) will show fewer linked records than the total population — that&apos;s the honest
            picture, not a bug. Most of this dashboard&apos;s episode-level metrics (dropout, medicine access, follow-up
            review, geography) don&apos;t depend on this linkage at all, since those fields are recorded directly on the
            episode; only patient-level segment rollups and the standalone lab/NCD-screening/history streams do.
          </p>
          <p className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-3 text-sm">
            <strong>These thresholds are heuristic, not empirically validated.</strong> This dataset supplies no
            cross-system patient crosswalk — there is no ground-truth &quot;this source record really is this canonical
            patient&quot; label to measure precision or recall against, for any source table. 0.72 / 0.55 / 0.03 were
            chosen as reasonable, documented, auditable cutoffs, not fit or calibrated against known-correct matches.
            &quot;High confidence&quot; on this page means &quot;scored above a threshold chosen without ground truth to
            check it against,&quot; not &quot;statistically validated confidence.&quot; Treat every linkage-dependent
            number on this dashboard accordingly.
          </p>
        </div>
      </ChartCard>

      {/* 3. Linkage confidence by source system */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Linkage confidence by source system"
          description="high / medium / ambiguous / unmatched counts per source table"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source system</TableHead>
                <TableHead className="text-right">Source IDs</TableHead>
                <TableHead className="text-right">High</TableHead>
                <TableHead className="text-right">Medium</TableHead>
                <TableHead className="text-right">Ambiguous</TableHead>
                <TableHead className="text-right">Unmatched</TableHead>
                <TableHead className="text-right">Linked %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataQuality.linkage_stats.map((s) => (
                <TableRow key={s.source_system}>
                  <TableCell className="font-medium">{s.source_system}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.distinct_source_ids.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.high.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.medium.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.ambiguous.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.unmatched.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{(s.linked_pct * 100).toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ChartCard>

        <ChartCard title="Linked % at a glance" description="Share of source records linked (high + medium confidence) per source system">
          <CountBarChart data={linkagePctData} horizontal />
        </ChartCard>
      </div>

      {/* 3b. Source-ID cardinality, static context from the audit */}
      <ChartCard
        title="Source-system ID cardinality"
        description="Why these tables need linkage at all: rows per source-local ID vs. rows per canonical patient (from the Phase 1 data audit, static)"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Source ID column</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Distinct IDs</TableHead>
              <TableHead className="text-right">Rows / ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SOURCE_ID_CARDINALITY.map((r) => (
              <TableRow key={r.file}>
                <TableCell className="font-mono text-xs">{r.file}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.idColumn}</TableCell>
                <TableCell className="text-right tabular-nums">{r.rows.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.distinctIds.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{r.rowsPerId.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>

      {/* 4. Village geography resolution */}
      <ChartCard
        title="Village geography resolution"
        description="Matching free-text village names to the 36 canonical villages — a separate, lighter-weight problem from patient linkage"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBlock label="Raw operational village strings" value={dataQuality.village_resolution.n_operational_villages_raw.toLocaleString()} />
          <StatBlock label="Canonical villages" value={dataQuality.village_resolution.n_canonical_villages.toLocaleString()} />
          <StatBlock label="Resolved" value={`${(dataQuality.village_resolution.resolved_pct * 100).toFixed(1)}%`} />
          <StatBlock label="Mean match score" value={dataQuality.village_resolution.mean_match_score.toFixed(2)} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          This is <strong>not</strong> patient-identity resolution — it&apos;s a block-blocked fuzzy match of free-text village
          name strings (spelling variants, not real village diversity) down to the 36 canonical villages in{" "}
          <code>geography_reference.csv</code>. Several of the raw variants are genuine misspellings rather than casing
          differences, so it can&apos;t be cleaned by lowercasing alone.
        </p>
      </ChartCard>

      {/* 5. Lab linkage coverage */}
      <ChartCard
        title="Lab test linkage coverage"
        description="lab_tests.csv rows have no direct episode key at all — they're matched to episodes via patient identity plus a date window"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBlock label="Episodes with test advised" value={dataQuality.lab_linkage.test_advised_episodes.toLocaleString()} />
          <StatBlock label="Matched" value={dataQuality.lab_linkage.matched.toLocaleString()} />
          <StatBlock label="Linkage unresolved" value={dataQuality.lab_linkage.linkage_unresolved.toLocaleString()} sub="Patient couldn't be resolved" />
          <StatBlock label="No match in window" value={dataQuality.lab_linkage.no_match_in_window.toLocaleString()} sub="Patient resolved, no lab in date window" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          This is distinct from the general source-system linkage rates in the table above: even once a{" "}
          <code>lab_tests</code> row is tied to a canonical patient, it still has to be associated with the right episode
          via a date window around the consult — two separate points where the association can fail.
        </p>
      </ChartCard>

      {/* 5b. Lab-to-episode ambiguity diagnostics (does not change the assignment algorithm) */}
      {labLinkageDiagnostics ? (
        <ChartCard
          title="How often is the lab-to-episode assignment actually ambiguous?"
          description="Quantifies the greedy nearest-date assignment's exposure to processing order, for patients with multiple nearby teleconsultations. See LAB_LINKAGE_DIAGNOSTICS.md for method."
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatBlock
              label="Patients with overlapping lab windows"
              value={labLinkageDiagnostics.window_overlap.patients_with_overlapping_test_advised_windows.toLocaleString()}
              sub={`${labLinkageDiagnostics.window_overlap.overlapping_episode_pairs.toLocaleString()} overlapping episode pairs`}
            />
            <StatBlock
              label="Lab records eligible for >1 episode"
              value={labLinkageDiagnostics.lab_record_contention.lab_records_eligible_for_more_than_one_episode.toLocaleString()}
              sub={`of ${labLinkageDiagnostics.lab_record_contention.lab_records_with_resolved_patient.toLocaleString()} patient-resolved lab records`}
            />
            <StatBlock
              label="Episodes competing for a contested record"
              value={labLinkageDiagnostics.lab_record_contention.episodes_competing_for_at_least_one_contested_lab_record.toLocaleString()}
            />
            <StatBlock
              label="Order-sensitive assignments"
              value={`${labLinkageDiagnostics.order_sensitivity_of_actual_assignments.order_sensitive_pct_of_matched.toFixed(1)}%`}
              sub={`${labLinkageDiagnostics.order_sensitivity_of_actual_assignments.order_sensitive_assignments.toLocaleString()} of ${labLinkageDiagnostics.order_sensitivity_of_actual_assignments.total_matched_assignments.toLocaleString()} matched`}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            &quot;Order-sensitive&quot; = of the lab records actually assigned to an episode, the share that were also
            eligible (within the same [-3,+45]-day window) for at least one other test-advised episode of the same
            patient — i.e. could plausibly have been assigned to a different episode under a different
            episode-processing order. This diagnostic does <strong>not</strong> change the assignment algorithm; it
            measures the existing one. At ~4.6% of matched assignments, this is a real but modest risk, not judged
            large enough on its own to justify changing the algorithm without further evidence — see
            LAB_LINKAGE_DIAGNOSTICS.md for the recommended next step.
          </p>
        </ChartCard>
      ) : null}

      {/* 6. Historical-behaviour linkage coverage */}
      <ChartCard
        title="Historical-behaviour linkage coverage"
        description="Prior-engagement features (visits in the 30/60/90 days before consult) depend on resolving each episode's patient in visit_history"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBlock label="Total episodes" value={dataQuality.history_linkage.total_episodes.toLocaleString()} />
          <StatBlock label="Matched" value={dataQuality.history_linkage.matched.toLocaleString()} />
          <StatBlock label="Linkage unresolved" value={dataQuality.history_linkage.linkage_unresolved.toLocaleString()} />
        </div>
      </ChartCard>

      {/* 7. Known data-quality findings */}
      <ChartCard
        title="Known data-quality findings"
        description="Specific findings from the Phase 1 data audit — what's real missingness vs. expected structure (static, computed once from the raw source files)"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field / area</TableHead>
              <TableHead>Finding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FINDINGS.map((f) => (
              <TableRow key={f.field}>
                <TableCell className="align-top font-medium whitespace-normal">{f.field}</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{f.finding}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ChartCard>
    </div>
  )
}
