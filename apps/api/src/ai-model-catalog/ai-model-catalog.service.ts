import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type AiModelCatalogOptionRow = {
  id: number;
  modelKey: string;
  displayName: string;
  provider: string;
  family: string;
  modality: string;
};

@Injectable()
export class AiModelCatalogService {
  constructor(private readonly dataSource: DataSource) {}

  async listOptions(): Promise<AiModelCatalogOptionRow[]> {
    return this.dataSource.query(
      `
      SELECT
        id,
        model_key AS modelKey,
        COALESCE(display_name, '') AS displayName,
        COALESCE(provider, '') AS provider,
        COALESCE(family, '') AS family,
        COALESCE(modality, '') AS modality
      FROM ai_model_catalog
      WHERE is_active = 1
      ORDER BY sort_order ASC, display_name ASC, model_key ASC
      `,
    );
  }
}
