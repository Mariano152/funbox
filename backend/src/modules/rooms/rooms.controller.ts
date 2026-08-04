import type { FastifyReply, FastifyRequest } from "fastify";
import { publishRoomUpdated } from "./rooms.events.js";
import {
  changeAvatarBodySchema,
  changeDjBodySchema,
  createRoomBodySchema,
  joinRoomBodySchema,
  roomCodeParamsSchema,
  startRoomBodySchema,
  updateMusicConfigBodySchema,
} from "./rooms.schemas.js";
import type { RoomsService } from "./rooms.service.js";

export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  create = async (request: FastifyRequest, reply: FastifyReply) => {
    const { gameKey, gameConfig } = createRoomBodySchema.parse(request.body);
    const normalizedConfig = gameKey === "guess-the-song"
      ? updateMusicConfigBodySchema.parse(gameConfig)
      : gameConfig;
    const result = await this.service.createRoom(gameKey, normalizedConfig);
    return reply.code(201).send(result);
  };

  changeAvatar = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    const { playerId, reconnectToken, avatarKey } = changeAvatarBodySchema.parse(request.body);
    const room = await this.service.changeAvatar(code, playerId, reconnectToken, avatarKey);
    publishRoomUpdated(room);
    return reply.send(room);
  };

  changeDj = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    const { playerId, reconnectToken, isDj } = changeDjBodySchema.parse(request.body);
    const room = await this.service.changeDjRole(code, playerId, reconnectToken, isDj);
    publishRoomUpdated(room);
    return reply.send(room);
  };

  findByCode = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return reply.send(await this.service.findRoom(code));
  };

  join = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    const { nickname, reconnectToken } = joinRoomBodySchema.parse(request.body);
    const result = await this.service.joinRoom(code, nickname, reconnectToken);
    publishRoomUpdated(result.room);
    return reply.code(result.reconnected ? 200 : 201).send(result);
  };

  start = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    const { playerId, reconnectToken } = startRoomBodySchema.parse(request.body);
    const room = await this.service.startRoom(code, playerId, reconnectToken);
    publishRoomUpdated(room);
    return reply.send(room);
  };

  updateMusicConfig = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    const gameConfig = updateMusicConfigBodySchema.parse(request.body);
    const room = await this.service.updateMusicConfig(code, gameConfig);
    publishRoomUpdated(room);
    return reply.send(room);
  };
}
