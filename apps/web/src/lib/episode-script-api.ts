import { apiClient } from './api'
import type {
  EpisodeScriptVersion,
  EpisodeScene,
  EpisodeShot,
  EpisodeShotPrompt,
  NarratorScriptGenerateDraftResponse,
  NarratorScriptPersistPayload,
  NarratorScriptPersistResponse,
} from '@/types/episode-script'

/** Script version summary row (active version per episode with counts) */
export interface EpisodeScriptVersionSummary {
  id: number
  novel_id: number
  episode_number: number
  version_no: number
  script_type: string
  title: string
  is_active: number
  scene_count: number
  shot_count: number
  prompt_count: number
}

/** Script versions */
export const episodeScriptVersionApi = {
  listByNovel: (novelId: number) =>
    apiClient(
      `/novels/${novelId}/episode-script-versions`
    ) as Promise<EpisodeScriptVersion[]>,

  listSummaryByNovel: (novelId: number) =>
    apiClient(
      `/novels/${novelId}/episode-script-versions/summary`
    ) as Promise<EpisodeScriptVersionSummary[]>,

  getByEpisode: (novelId: number, episodeNumber: number) =>
    apiClient(
      `/novels/${novelId}/episode-script-versions/${episodeNumber}`
    ) as Promise<EpisodeScriptVersion[]>,

  create: (novelId: number, body: Record<string, unknown>) =>
    apiClient(`/novels/${novelId}/episode-script-versions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<EpisodeScriptVersion>,

  update: (id: number, body: Record<string, unknown>) =>
    apiClient(`/episode-script-versions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as Promise<EpisodeScriptVersion>,

  setActive: (id: number) =>
    apiClient(`/episode-script-versions/${id}/set-active`, {
      method: 'POST',
    }) as Promise<EpisodeScriptVersion>,

  remove: (id: number) =>
    apiClient(`/episode-script-versions/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
}

/** Scenes (by script version) */
export const episodeSceneApi = {
  listByScriptVersion: (scriptVersionId: number) =>
    apiClient(
      `/episode-script-versions/${scriptVersionId}/scenes`
    ) as Promise<EpisodeScene[]>,

  create: (scriptVersionId: number, body: Record<string, unknown>) =>
    apiClient(`/episode-script-versions/${scriptVersionId}/scenes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<EpisodeScene>,

  update: (id: number, body: Record<string, unknown>) =>
    apiClient(`/episode-scenes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as Promise<EpisodeScene>,

  remove: (id: number) =>
    apiClient(`/episode-scenes/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
}

/** Shots (by scene) */
export const episodeShotApi = {
  listByScene: (sceneId: number) =>
    apiClient(`/episode-scenes/${sceneId}/shots`) as Promise<EpisodeShot[]>,

  create: (sceneId: number, body: Record<string, unknown>) =>
    apiClient(`/episode-scenes/${sceneId}/shots`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<EpisodeShot>,

  update: (id: number, body: Record<string, unknown>) =>
    apiClient(`/episode-shots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as Promise<EpisodeShot>,

  remove: (id: number) =>
    apiClient(`/episode-shots/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
}

/** Shot prompts (by shot) */
export const episodeShotPromptApi = {
  listByShot: (shotId: number) =>
    apiClient(
      `/episode-shots/${shotId}/prompts`
    ) as Promise<EpisodeShotPrompt[]>,

  create: (shotId: number, body: Record<string, unknown>) =>
    apiClient(`/episode-shots/${shotId}/prompts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<EpisodeShotPrompt>,

  update: (id: number, body: Record<string, unknown>) =>
    apiClient(`/episode-shot-prompts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as Promise<EpisodeShotPrompt>,

  remove: (id: number) =>
    apiClient(`/episode-shot-prompts/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
}

/** Narrator script generate / persist */
export const narratorScriptApi = {
  generateDraft: (
    novelId: number,
    params?: {
      targetEpisodeCount?: number
      startEpisode?: number
      endEpisode?: number
      batchSize?: number
      modelKey?: string
    },
  ) =>
    apiClient(`/pipeline/${novelId}/narrator-script-generate-draft`, {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    }) as Promise<NarratorScriptGenerateDraftResponse>,

  persistDraft: (novelId: number, payload: NarratorScriptPersistPayload) =>
    apiClient(`/pipeline/${novelId}/narrator-script-persist`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<NarratorScriptPersistResponse>,
}
