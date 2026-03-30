import { Injectable } from '@nestjs/common';

export interface DouyinOptimizationFact {
  videoStreamId: string;
  requestedQuality: string;
  actualQuality: string;
  line: string;
  candidateUrl: string;
  candidateId?: string;
  finalUrl: string;
  actualUrl: string;
  actualWidth: number;
  actualHeight: number;
  usedWatermarkFallback: boolean;
  verifiedAt: number;
}

interface CachedOptimizationFact {
  expiresAt: number;
  fact: DouyinOptimizationFact;
}

interface SelectDouyinOptimizationFactInput {
  videoStreamId: string;
  qualityOrder: string[];
  availableRequestedQualities?: string[];
  availableCandidateUrlsByQuality?: Record<string, string[]>;
  allowWatermarkFallback: boolean;
  minimumActualQualityRank?: number;
  getQualityRank: (value: string) => number;
}

@Injectable()
export class DouyinOptimizationService {
  private readonly cacheTtlMs = this.readPositiveIntEnv(
    'DOUYIN_OPTIMIZATION_CACHE_TTL_MS',
    20 * 60 * 1000,
  );
  private readonly factCache = new Map<string, CachedOptimizationFact>();
  private readonly warmInflight = new Map<string, Promise<void>>();

  upsertFact(input: Omit<DouyinOptimizationFact, 'verifiedAt'> & { verifiedAt?: number }): void {
    const requestedQuality = this.normalizeQuality(input.requestedQuality);
    const actualQuality = this.clampActualQuality(
      requestedQuality,
      this.normalizeQuality(input.actualQuality) || requestedQuality,
    );
    const fact: DouyinOptimizationFact = {
      ...input,
      requestedQuality,
      actualQuality,
      line: String(input.line || '').trim() || '0',
      candidateUrl: String(input.candidateUrl || '').trim(),
      candidateId:
        String(input.candidateId || '').trim() ||
        this.buildCandidateIdentity(String(input.candidateUrl || '').trim()),
      finalUrl: String(input.finalUrl || '').trim(),
      actualUrl: String(input.actualUrl || '').trim(),
      actualWidth: Math.max(0, Math.round(Number(input.actualWidth) || 0)),
      actualHeight: Math.max(0, Math.round(Number(input.actualHeight) || 0)),
      usedWatermarkFallback: input.usedWatermarkFallback === true,
      verifiedAt: Math.max(0, Math.round(Number(input.verifiedAt) || Date.now())),
      videoStreamId: String(input.videoStreamId || '').trim(),
    };

    if (!fact.videoStreamId || !fact.requestedQuality || !fact.candidateUrl) {
      return;
    }

    this.pruneExpiredFacts();
    this.factCache.set(this.buildFactKey(fact), {
      expiresAt: Date.now() + this.cacheTtlMs,
      fact,
    });
  }

  selectBestFact(
    input: SelectDouyinOptimizationFactInput,
  ): DouyinOptimizationFact | null {
    const videoStreamId = String(input.videoStreamId || '').trim();
    if (!videoStreamId) {
      return null;
    }

    const qualityOrder = Array.from(
      new Set(
        (input.qualityOrder || [])
          .map((item) => this.normalizeQuality(item))
          .filter(Boolean),
      ),
    );
    if (qualityOrder.length === 0) {
      return null;
    }

    const availableRequestedQualities = new Set(
      (input.availableRequestedQualities || [])
        .map((item) => this.normalizeQuality(item))
        .filter(Boolean),
    );
    const availableCandidateIdsByQuality = new Map<string, Set<string>>();
    Object.entries(input.availableCandidateUrlsByQuality || {}).forEach(
      ([quality, urls]) => {
        const normalizedQuality = this.normalizeQuality(quality);
        if (!normalizedQuality) {
          return;
        }
        const candidateIds = new Set(
          (urls || [])
            .map((url) => this.buildCandidateIdentity(url))
            .filter(Boolean),
        );
        if (candidateIds.size > 0) {
          availableCandidateIdsByQuality.set(normalizedQuality, candidateIds);
        }
      },
    );
    const minimumActualQualityRank = Number.isFinite(input.minimumActualQualityRank)
      ? Number(input.minimumActualQualityRank)
      : null;

    this.pruneExpiredFacts();
    const requestedRank = input.getQualityRank(qualityOrder[0]);
    const candidates = qualityOrder.flatMap((quality, orderIndex) =>
      availableRequestedQualities.size > 0 && !availableRequestedQualities.has(quality)
        ? []
        :
      this.getFactsForQuality(videoStreamId, quality)
        .filter((fact) => {
          const availableCandidateIds = availableCandidateIdsByQuality.get(quality);
          if (
            availableCandidateIds &&
            availableCandidateIds.size > 0 &&
            !availableCandidateIds.has(this.getFactCandidateId(fact))
          ) {
            return false;
          }

          if (!input.allowWatermarkFallback && fact.usedWatermarkFallback) {
            return false;
          }

          if (minimumActualQualityRank === null) {
            return true;
          }

          return input.getQualityRank(fact.actualQuality) >= minimumActualQualityRank;
        })
        .map((fact) => ({
          fact,
          orderIndex,
        })),
    );

    if (candidates.length === 0) {
      return null;
    }

    return candidates.sort((left, right) =>
      this.compareFactsForSelection(
        left.fact,
        right.fact,
        left.orderIndex,
        right.orderIndex,
        requestedRank,
        input.getQualityRank,
      ),
    )[0]?.fact || null;
  }

  getFactForCandidate(input: {
    videoStreamId: string;
    requestedQuality: string;
    candidateUrl: string;
    allowWatermarkFallback: boolean;
  }): DouyinOptimizationFact | null {
    return this.selectBestFact({
      videoStreamId: input.videoStreamId,
      qualityOrder: [input.requestedQuality],
      availableRequestedQualities: [input.requestedQuality],
      availableCandidateUrlsByQuality: {
        [input.requestedQuality]: [input.candidateUrl],
      },
      allowWatermarkFallback: input.allowWatermarkFallback,
      getQualityRank: (value) => this.defaultQualityRank(value),
    });
  }

  buildMergedQualityMap(videoStreamId: string): Record<string, string> {
    const normalizedStreamId = String(videoStreamId || '').trim();
    if (!normalizedStreamId) {
      return {};
    }

    this.pruneExpiredFacts();
    const getQualityRank = (value: string) => this.defaultQualityRank(value);

    const bestByQuality = new Map<string, DouyinOptimizationFact>();
    for (const { fact } of this.factCache.values()) {
      if (fact.videoStreamId !== normalizedStreamId) {
        continue;
      }

      const targetQuality = this.normalizeQuality(fact.actualQuality) || fact.requestedQuality;
      if (!targetQuality) {
        continue;
      }

      const current = bestByQuality.get(targetQuality);
      if (!current || this.compareFacts(fact, current, getQualityRank) < 0) {
        bestByQuality.set(targetQuality, fact);
      }
    }

    return Array.from(bestByQuality.entries()).reduce(
      (acc, [quality, fact]) => {
        const selectedUrl = fact.actualUrl || fact.finalUrl || fact.candidateUrl;
        if (selectedUrl) {
          acc[quality] = selectedUrl;
        }
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  runWarmTaskOnce(videoStreamId: string, taskFactory: () => Promise<void>): Promise<void> {
    const normalizedStreamId = String(videoStreamId || '').trim();
    if (!normalizedStreamId) {
      return Promise.resolve();
    }

    const existing = this.warmInflight.get(normalizedStreamId);
    if (existing) {
      return existing;
    }

    const task = taskFactory().finally(() => {
      if (this.warmInflight.get(normalizedStreamId) === task) {
        this.warmInflight.delete(normalizedStreamId);
      }
    });
    this.warmInflight.set(normalizedStreamId, task);
    return task;
  }

  getWarmTask(videoStreamId: string): Promise<void> | null {
    const normalizedStreamId = String(videoStreamId || '').trim();
    if (!normalizedStreamId) {
      return null;
    }

    return this.warmInflight.get(normalizedStreamId) || null;
  }

  clearForTests(): void {
    this.factCache.clear();
    this.warmInflight.clear();
  }

  private getFactsForQuality(
    videoStreamId: string,
    requestedQuality: string,
  ): DouyinOptimizationFact[] {
    const normalizedQuality = this.normalizeQuality(requestedQuality);
    if (!normalizedQuality) {
      return [];
    }

    return Array.from(this.factCache.values())
      .map((item) => item.fact)
      .filter((fact) => {
        return (
          fact.videoStreamId === videoStreamId &&
          fact.requestedQuality === normalizedQuality
        );
      });
  }

  private compareFacts(
    left: DouyinOptimizationFact,
    right: DouyinOptimizationFact,
    getQualityRank: (value: string) => number,
  ): number {
    const watermarkGap =
      (left.usedWatermarkFallback ? 1 : 0) - (right.usedWatermarkFallback ? 1 : 0);
    if (watermarkGap !== 0) {
      return watermarkGap;
    }

    const qualityGap =
      getQualityRank(right.actualQuality) - getQualityRank(left.actualQuality);
    if (qualityGap !== 0) {
      return qualityGap;
    }

    const resolutionGap =
      right.actualWidth * right.actualHeight - left.actualWidth * left.actualHeight;
    if (resolutionGap !== 0) {
      return resolutionGap;
    }

    return right.verifiedAt - left.verifiedAt;
  }

  private compareFactsForSelection(
    left: DouyinOptimizationFact,
    right: DouyinOptimizationFact,
    leftOrderIndex: number,
    rightOrderIndex: number,
    requestedRank: number,
    getQualityRank: (value: string) => number,
  ): number {
    const watermarkGap =
      (left.usedWatermarkFallback ? 1 : 0) - (right.usedWatermarkFallback ? 1 : 0);
    if (watermarkGap !== 0) {
      return watermarkGap;
    }

    const leftPreference = this.getSelectionPreference(
      getQualityRank(left.actualQuality),
      requestedRank,
    );
    const rightPreference = this.getSelectionPreference(
      getQualityRank(right.actualQuality),
      requestedRank,
    );
    if (leftPreference.tier !== rightPreference.tier) {
      return leftPreference.tier - rightPreference.tier;
    }
    if (leftPreference.distance !== rightPreference.distance) {
      return leftPreference.distance - rightPreference.distance;
    }
    if (leftOrderIndex !== rightOrderIndex) {
      return leftOrderIndex - rightOrderIndex;
    }

    const leftResolutionDistance = this.getResolutionDistanceFromRequested(
      left,
      requestedRank,
      getQualityRank,
    );
    const rightResolutionDistance = this.getResolutionDistanceFromRequested(
      right,
      requestedRank,
      getQualityRank,
    );
    if (leftResolutionDistance !== rightResolutionDistance) {
      return leftResolutionDistance - rightResolutionDistance;
    }

    return this.compareFacts(left, right, getQualityRank);
  }

  private getSelectionPreference(
    actualRank: number,
    requestedRank: number,
  ): { tier: number; distance: number } {
    if (requestedRank < 0 || actualRank < 0) {
      return { tier: 3, distance: Number.MAX_SAFE_INTEGER };
    }

    if (actualRank === requestedRank) {
      return { tier: 0, distance: 0 };
    }

    if (actualRank < requestedRank) {
      return { tier: 1, distance: requestedRank - actualRank };
    }

    return { tier: 2, distance: actualRank - requestedRank };
  }

  private buildFactKey(fact: DouyinOptimizationFact): string {
    return [
      fact.videoStreamId,
      fact.requestedQuality,
      this.getFactCandidateId(fact),
    ].join('|');
  }

  private getFactCandidateId(fact: DouyinOptimizationFact): string {
    return (
      String(fact.candidateId || '').trim() ||
      this.buildCandidateIdentity(fact.candidateUrl)
    );
  }

  private buildCandidateIdentity(candidateUrl: string): string {
    const normalizedUrl = String(candidateUrl || '').trim();
    if (!normalizedUrl) {
      return '';
    }

    try {
      const parsed = new URL(normalizedUrl);
      return (
        parsed.searchParams.get('file_id') ||
        parsed.pathname.split('/').filter(Boolean).pop() ||
        parsed.toString()
      );
    } catch (_error) {
      const matched = normalizedUrl.match(/[?&]file_id=([^&#]+)/i);
      if (matched?.[1]) {
        return decodeURIComponent(matched[1]);
      }
      const pathMatched = normalizedUrl.match(/\/([^/?#]+)(?:\?|#|$)/);
      return pathMatched?.[1] || normalizedUrl;
    }
  }

  private getResolutionDistanceFromRequested(
    fact: DouyinOptimizationFact,
    requestedRank: number,
    getQualityRank: (value: string) => number,
  ): number {
    if (requestedRank < 0) {
      return Number.MAX_SAFE_INTEGER;
    }

    const qualityDistance = Math.abs(
      getQualityRank(fact.actualQuality) - requestedRank,
    );
    if (qualityDistance > 0) {
      return qualityDistance * 10_000;
    }

    const shortEdge = Math.min(
      Math.max(0, Number(fact.actualWidth) || 0),
      Math.max(0, Number(fact.actualHeight) || 0),
    );
    if (shortEdge <= 0) {
      return Number.MAX_SAFE_INTEGER;
    }

    return Math.abs(shortEdge - requestedRank);
  }

  private pruneExpiredFacts(): void {
    const now = Date.now();
    for (const [key, value] of this.factCache.entries()) {
      if (value.expiresAt <= now) {
        this.factCache.delete(key);
      }
    }
  }

  private normalizeQuality(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private defaultQualityRank(value: string): number {
    const normalized = this.normalizeQuality(value);
    if (normalized === '4k' || normalized === '2160p') {
      return 2160;
    }
    if (normalized === '1440p') {
      return 1440;
    }
    if (normalized === '1080p') {
      return 1080;
    }
    if (normalized === '720p') {
      return 720;
    }
    if (normalized === '540p') {
      return 540;
    }
    if (normalized === '480p') {
      return 480;
    }
    if (normalized === '360p') {
      return 360;
    }

    const matched = normalized.match(/(\d{3,4})p/);
    if (matched?.[1]) {
      return Number.parseInt(matched[1], 10);
    }
    return -1;
  }

  private clampActualQuality(requestedQuality: string, actualQuality: string): string {
    const requestedRank = this.defaultQualityRank(requestedQuality);
    const actualRank = this.defaultQualityRank(actualQuality);
    if (requestedRank > 0 && actualRank > requestedRank) {
      return requestedQuality;
    }
    return actualQuality;
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
