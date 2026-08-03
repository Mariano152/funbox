import type { FastifyReply, FastifyRequest } from "fastify";
import {
  connectDjBodySchema,
  djTokenBodySchema,
  manualTrackBodySchema,
  musicAnswerBodySchema,
  musicDraftBodySchema,
  musicSuggestionsQuerySchema,
  musicCodeParamsSchema,
  pauseMusicBodySchema,
} from "./music.schemas.js";
import type { MusicService } from "./music.service.js";
import { searchMusicSuggestions } from "./music-suggestions.service.js";

export class MusicController {
  constructor(private readonly service: MusicService) {}

  connectDj = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const { playerId, reconnectToken } = connectDjBodySchema.parse(request.body);
    return reply.code(201).send(await this.service.connectDj(code, playerId, reconnectToken));
  };

  getState = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    return reply.send(await this.service.getState(code));
  };

  answer = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const input = musicAnswerBodySchema.parse(request.body);
    return reply.send(await this.service.submitAnswer(code, input));
  };

  draft = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const input = musicDraftBodySchema.parse(request.body);
    return reply.send(await this.service.saveAnswerDraft(code, input));
  };

  suggestions = async (request: FastifyRequest, reply: FastifyReply) => {
    const { type, q } = musicSuggestionsQuerySchema.parse(request.query);
    return reply.send({ suggestions: await searchMusicSuggestions(type, q) });
  };

  prepare = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const { djToken } = djTokenBodySchema.parse(request.body);
    return reply.send(await this.service.prepareRound(code, djToken));
  };

  started = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const { djToken } = djTokenBodySchema.parse(request.body);
    return reply.send(await this.service.markStarted(code, djToken));
  };

  manual = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const input = manualTrackBodySchema.parse(request.body);
    return reply.send(await this.service.prepareManual(code, input.djToken, input));
  };

  reveal = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const { djToken } = djTokenBodySchema.parse(request.body);
    return reply.send(await this.service.reveal(code, djToken));
  };

  finishClip = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const { djToken } = djTokenBodySchema.parse(request.body);
    return reply.send(await this.service.finishClip(code, djToken));
  };

  pause = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    const { paused } = pauseMusicBodySchema.parse(request.body);
    return reply.send(await this.service.setPaused(code, paused));
  };

  returnToLobby = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = musicCodeParamsSchema.parse(request.params);
    return reply.send(await this.service.returnToLobby(code));
  };
}
