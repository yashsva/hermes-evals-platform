import { Injectable, Logger } from '@nestjs/common';

export interface ModelPrice {
  /** USD per million tokens. */
  inputPerM: number;
  outputPerM: number;
}

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Model prices from OpenRouter's public model list (no key needed), cached for 6h.
 * Experiments copy the prices they used, so later price changes don't rewrite old cost figures.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);
  private prices = new Map<string, ModelPrice>();
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;

  async priceFor(models: string[]): Promise<Record<string, ModelPrice>> {
    await this.refreshIfStale();
    const out: Record<string, ModelPrice> = {};
    for (const model of models) {
      const price = this.prices.get(model);
      if (price) out[model] = price;
    }
    return out;
  }

  private async refreshIfStale(): Promise<void> {
    if (Date.now() - this.fetchedAt < REFRESH_MS) return;
    this.inflight ??= this.refresh().finally(() => (this.inflight = null));
    await this.inflight;
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
      const next = new Map<string, ModelPrice>();
      for (const model of body.data) {
        const input = Number(model.pricing?.prompt);
        const output = Number(model.pricing?.completion);
        if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
          next.set(model.id, { inputPerM: input * 1e6, outputPerM: output * 1e6 });
        }
      }
      this.prices = next;
      this.fetchedAt = Date.now();
      this.logger.log(`Loaded prices for ${next.size} models`);
    } catch (err) {
      // Keep the previous table; retry in a minute rather than on every call.
      this.fetchedAt = Date.now() - REFRESH_MS + 60_000;
      this.logger.warn(`Could not load OpenRouter prices: ${(err as Error).message}`);
    }
  }
}

/**
 * Upper-bound cost: all input tokens at the full input rate (cache-read discounts are ignored
 * because providers report cached tokens inconsistently).
 */
export function costUsd(price: ModelPrice | undefined, tokensIn: number, tokensOut: number): number | null {
  if (!price) return null;
  return (tokensIn * price.inputPerM + tokensOut * price.outputPerM) / 1e6;
}
