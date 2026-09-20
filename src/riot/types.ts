/**
 * Types des DTO Riot réellement utilisés par Ezreal.
 *
 * Les noms de champs ont été repris de la référence officielle (ACCOUNT-V1 et
 * MATCH-V5). Tout ce qui n'est pas garanti présent sur toutes les parties ou
 * toutes les versions du jeu est déclaré optionnel : le code doit toujours
 * savoir se comporter quand une donnée manque plutôt que de la supposer.
 */

export interface AccountDto {
  puuid: string;
  gameName?: string;
  tagLine?: string;
}

export interface ChallengesDto {
  kda?: number;
  killParticipation?: number;
  goldPerMinute?: number;
  damagePerMinute?: number;
  teamDamagePercentage?: number;
  visionScorePerMinute?: number;
  visionScoreAdvantageLaneOpponent?: number;
  laneMinionsFirst10Minutes?: number;
  jungleCsBefore10Minutes?: number;
  maxCsAdvantageOnLaneOpponent?: number;
  laningPhaseGoldExpAdvantage?: number;
  earlyLaningPhaseGoldExpAdvantage?: number;
  soloKills?: number;
  controlWardsPlaced?: number;
  wardTakedowns?: number;
  effectiveHealAndShielding?: number;
  saveAllyFromDeath?: number;
  turretPlatesTaken?: number;
  deathsByEnemyChamps?: number;
  [key: string]: unknown;
}

export interface ParticipantDto {
  puuid: string;
  participantId: number;
  teamId: number;
  win: boolean;

  championName: string;
  championId?: number;
  champLevel?: number;

  riotIdGameName?: string;
  riotIdTagline?: string;
  summonerName?: string;

  /** « TOP » | « JUNGLE » | « MIDDLE » | « BOTTOM » | « UTILITY » | « » */
  teamPosition?: string;
  individualPosition?: string;
  lane?: string;
  role?: string;

  kills: number;
  deaths: number;
  assists: number;

  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  goldEarned?: number;

  totalDamageDealtToChampions?: number;
  totalDamageTaken?: number;
  damageDealtToObjectives?: number;
  damageDealtToTurrets?: number;

  visionScore?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  detectorWardsPlaced?: number;
  visionWardsBoughtInGame?: number;

  totalHealsOnTeammates?: number;
  totalDamageShieldedOnTeammates?: number;

  dragonKills?: number;
  baronKills?: number;
  turretTakedowns?: number;
  objectivesStolen?: number;

  totalTimeSpentDead?: number;
  timePlayed?: number;

  gameEndedInEarlySurrender?: boolean;
  gameEndedInSurrender?: boolean;

  challenges?: ChallengesDto;
}

export interface ObjectiveDto {
  first?: boolean;
  kills?: number;
}

export interface ObjectivesDto {
  baron?: ObjectiveDto;
  champion?: ObjectiveDto;
  dragon?: ObjectiveDto;
  horde?: ObjectiveDto;
  inhibitor?: ObjectiveDto;
  riftHerald?: ObjectiveDto;
  tower?: ObjectiveDto;
  atakhan?: ObjectiveDto;
}

export interface TeamDto {
  teamId: number;
  win?: boolean;
  objectives?: ObjectivesDto;
}

export interface InfoDto {
  gameCreation?: number;
  gameStartTimestamp?: number;
  gameEndTimestamp?: number;
  /**
   * Piège connu de MATCH-V5 : cette valeur est en secondes dès lors que
   * « gameEndTimestamp » est présent, et en millisecondes sur les parties plus
   * anciennes. Voir resolveDurationSeconds() dans analysis/stats.ts.
   */
  gameDuration?: number;
  gameMode?: string;
  gameType?: string;
  gameVersion?: string;
  mapId?: number;
  queueId?: number;
  platformId?: string;
  endOfGameResult?: string;
  participants: ParticipantDto[];
  teams?: TeamDto[];
}

export interface MetadataDto {
  dataVersion?: string;
  matchId: string;
  participants?: string[];
}

export interface MatchDto {
  metadata: MetadataDto;
  info: InfoDto;
}

// --- Timeline -------------------------------------------------------------

export interface PositionDto {
  x?: number;
  y?: number;
}

export interface EventTimelineDto {
  timestamp?: number;
  type?: string;
  participantId?: number;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  creatorId?: number;
  wardType?: string;
  monsterType?: string;
  monsterSubType?: string;
  buildingType?: string;
  towerType?: string;
  laneType?: string;
  teamId?: number;
  killerTeamId?: number;
  position?: PositionDto;
  [key: string]: unknown;
}

export interface ParticipantFrameDto {
  participantId?: number;
  level?: number;
  xp?: number;
  totalGold?: number;
  currentGold?: number;
  minionsKilled?: number;
  jungleMinionsKilled?: number;
  position?: PositionDto;
}

export interface FrameTimelineDto {
  timestamp?: number;
  events?: EventTimelineDto[];
  participantFrames?: Record<string, ParticipantFrameDto>;
}

export interface ParticipantTimelineIdDto {
  participantId?: number;
  puuid?: string;
}

export interface InfoTimelineDto {
  frameInterval?: number;
  frames?: FrameTimelineDto[];
  participants?: ParticipantTimelineIdDto[];
}

export interface TimelineDto {
  metadata: MetadataDto;
  info: InfoTimelineDto;
}
