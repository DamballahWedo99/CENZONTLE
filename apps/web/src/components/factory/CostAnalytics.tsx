'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useFactory } from '@/context/FactoryContext';
import type { CostBreakdown } from '@cenzontle/shared';
import {
  DollarSign,
  Coins,
  TrendingUp,
  Bot,
  BookOpen,
} from 'lucide-react';

// -- Formatters --------------------------------------------------------------

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

// -- Sub-components ----------------------------------------------------------

function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-lg border border-[#2A2A35] bg-[#0A0A0F] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-[#8B8B9A]" />
        <span className="text-xs font-medium text-[#8B8B9A]">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-[#EDEDF0]">{value}</div>
      {subtext && (
        <span className="text-[11px] text-[#8B8B9A] mt-0.5 block">{subtext}</span>
      )}
    </div>
  );
}

function AgentCostTable({
  agents,
}: {
  agents: CostBreakdown['agentCosts'];
}) {
  const sorted = useMemo(
    () => [...agents].sort((a, b) => b.cost - a.cost),
    [agents],
  );

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2A2A35]">
        <Bot className="h-4 w-4 text-[#8B8B9A]" />
        <h3 className="text-sm font-semibold text-[#EDEDF0]">Cost per Agent</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left" role="grid" aria-label="Cost breakdown per agent">
          <thead>
            <tr className="border-b border-[#2A2A35] bg-[#0A0A0F]">
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider">
                Agent
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-right">
                Tokens
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-right">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-[#8B8B9A]">
                  No agent cost data.
                </td>
              </tr>
            ) : (
              sorted.map((agent) => (
                <tr
                  key={agent.agentId}
                  className="border-b border-[#2A2A35] hover:bg-[#1A1A22] transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <div className="text-sm text-[#EDEDF0]">{agent.agentName}</div>
                    <span className="text-[11px] font-mono text-[#8B8B9A]">{agent.agentId}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-[#8B8B9A] text-right">
                    {formatTokens(agent.tokens)}
                  </td>
                  <td className="px-3 py-2.5 text-sm tabular-nums text-[#EDEDF0] text-right font-medium">
                    {formatCost(agent.cost)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StoryCostTable({
  stories,
}: {
  stories: CostBreakdown['storyCosts'];
}) {
  const sorted = useMemo(
    () => [...stories].sort((a, b) => b.cost - a.cost),
    [stories],
  );

  return (
    <div className="rounded-xl border border-[#2A2A35] bg-[#141419] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2A2A35]">
        <BookOpen className="h-4 w-4 text-[#8B8B9A]" />
        <h3 className="text-sm font-semibold text-[#EDEDF0]">Cost per Story</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left" role="grid" aria-label="Cost breakdown per story">
          <thead>
            <tr className="border-b border-[#2A2A35] bg-[#0A0A0F]">
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider">
                Story
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-right">
                Tokens
              </th>
              <th scope="col" className="px-3 py-2 text-[11px] font-medium text-[#8B8B9A] uppercase tracking-wider text-right">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-[#8B8B9A]">
                  No story cost data.
                </td>
              </tr>
            ) : (
              sorted.map((story) => (
                <tr
                  key={story.storyId}
                  className="border-b border-[#2A2A35] hover:bg-[#1A1A22] transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <span className="text-sm font-mono text-[#EDEDF0]">{story.storyKey}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-[#8B8B9A] text-right">
                    {formatTokens(story.tokens)}
                  </td>
                  <td className="px-3 py-2.5 text-sm tabular-nums text-[#EDEDF0] text-right font-medium">
                    {formatCost(story.cost)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -- Main Component ----------------------------------------------------------

export function CostAnalytics() {
  const { state } = useFactory();
  const cost = state.cost;

  return (
    <div className="space-y-4">
      {/* Top metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          icon={DollarSign}
          label="Total Cost"
          value={formatCost(cost.totalCost)}
        />
        <MetricCard
          icon={Coins}
          label="Total Tokens"
          value={formatTokens(cost.totalTokens)}
        />
        <MetricCard
          icon={TrendingUp}
          label="Projected Monthly"
          value={formatCost(cost.projectedMonthlyCost)}
        />
      </div>

      {/* Cost tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgentCostTable agents={cost.agentCosts} />
        <StoryCostTable stories={cost.storyCosts} />
      </div>
    </div>
  );
}
