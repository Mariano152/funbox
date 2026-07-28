import type { FastifyReply, FastifyRequest } from "fastify";
import { publishRoomUpdated } from "./rooms.events.js";
import {
  changeAvatarBodySchema,
  joinRoomBodySchema,
  roomCodeParamsSchema,
  startRoomBodySchema,
} from "./rooms.schemas.js";
import type { RoomsService } from "./rooms.service.js";

export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  create = async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.service.createRoom();
    return reply.code(201).send(result);
  };

  changeAvatar = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
    const { playerId, reconnectToken, avatarKey } = changeAvatarBodySchema.parse(request.body);
    const room = await this.service.changeAvatar(code, playerId, reconnectToken, avatarKey);
    publishRoomUpdated(room);
    return reply.send(room);
  };

  findByCode = async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = roomCodeParamsSchema.parse(request.params);
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
}
