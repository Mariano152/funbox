import type { FastifyReply, FastifyRequest } from "fastify";
import { triviaService } from "../services.js";
import { triviaAnswerSchema, triviaCodeSchema, triviaPauseSchema } from "./trivia.schemas.js";
export class TriviaController {
  state = async (request: FastifyRequest, reply: FastifyReply) => { const { code } = triviaCodeSchema.parse(request.params); return reply.send(triviaService.state(code)); };
  next = async (request: FastifyRequest, reply: FastifyReply) => { const { code } = triviaCodeSchema.parse(request.params); return reply.send(await triviaService.next(code)); };
  reveal = async (request: FastifyRequest, reply: FastifyReply) => { const { code } = triviaCodeSchema.parse(request.params); return reply.send(await triviaService.reveal(code)); };
  replay = async (request: FastifyRequest, reply: FastifyReply) => { const { code } = triviaCodeSchema.parse(request.params); return reply.send(await triviaService.replay(code)); };
  answer = async (request: FastifyRequest, reply: FastifyReply) => { const { code } = triviaCodeSchema.parse(request.params); const body = triviaAnswerSchema.parse(request.body); return reply.send(await triviaService.answer(code, body.playerId, body.reconnectToken, body.optionIndex)); };
  pause = async (request: FastifyRequest, reply: FastifyReply) => { const { code } = triviaCodeSchema.parse(request.params); const { paused } = triviaPauseSchema.parse(request.body); return reply.send(await triviaService.setPaused(code, paused)); };
}
