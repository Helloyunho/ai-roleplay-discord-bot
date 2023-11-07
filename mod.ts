import {
  GatewayIntent,
  APIManager,
  CreateGlobalApplicationCommandPayload,
  ApplicationCommandType,
  ApplicationCommandInteractionDataPayload,
  GuildThreadChannelPayload,
  InteractionResponsePayload,
  InteractionCallbackType,
  OpenAI
} from './deps.ts'
import { Message } from './types/message.ts'
import { Run } from './types/run.ts'
import { Thread } from './types/thread.ts'
import { DISCORD_BOT_ID, OPENAI_ASSISTANT_ID } from './const.ts'

const listeningChannels: {
  [key: string]: {
    threadID: string
    lastMessageID?: string
  }
} = {}

const client = new APIManager(Deno.env.get('BOT_TOKEN')!, {
  gateway: {
    intents: GatewayIntent.GUILD_MESSAGES | (1 << 15)
  }
})

const openAI = new OpenAI()

const createResponse = async (cid: string, content: string) => {
  const { threadID, lastMessageID } = listeningChannels[cid]

  await openAI.request({
    method: 'POST',
    url: `/threads/${threadID}/messages`,
    body: {
      role: 'user',
      content: content
    },
    headers: {
      'OpenAI-Beta': 'assistants=v1'
    }
  })
  let run: Run = await openAI.request({
    method: 'POST',
    url: `/threads/${threadID}/runs`,
    body: {
      assistant_id: OPENAI_ASSISTANT_ID
    },
    headers: {
      'OpenAI-Beta': 'assistants=v1'
    }
  })
  while (!['failed', 'completed', 'expired'].includes(run.status)) {
    run = await openAI.request({
      method: 'GET',
      url: `/threads/${threadID}/runs/${run.id}`,
      headers: {
        'OpenAI-Beta': 'assistants=v1'
      }
    })
  }
  if (run.status === 'failed') {
    await client.post(`/channels/${cid}/messages`, {
      body: {
        content: `오류 발생!
\`\`\`${run.last_error!.message}\`\`\`
...하지만 계속 이어서 할 수 있어요!`
      }
    })
    return
  } else if (run.status === 'expired') {
    await client.post(`/channels/${cid}/messages`, {
      body: {
        content:
          '대화를 처리하는데 너무 오래걸려 중단되었어요!\n...하지만 계속 이어서 할 수 있어요!'
      }
    })
    return
  }
  const { data: msgs }: { data: [Message] } = await openAI.request({
    method: 'GET',
    url: `/threads/${threadID}/messages`,
    query: {
      before: lastMessageID ?? ''
    },
    headers: {
      'OpenAI-Beta': 'assistants=v1'
    }
  })

  const assistantMsgs = msgs.filter((msg) => msg.role === 'assistant')
  if (assistantMsgs.length === 0) {
    await client.post(`/channels/${cid}/messages`, {
      body: {
        content:
          'AI가 아무런 대답이 없어요!\n...하지만 계속 이어서 할 수 있어요!'
      }
    })
    return
  }

  await client.post(`/channels/${cid}/messages`, {
    body: {
      content: msgs
        .filter((msg) => msg.role === 'assistant')
        .map((msg) =>
          msg.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text!.value)
            .join('')
        )
        .join('\n\n')
    }
  })

  listeningChannels[cid].lastMessageID = msgs[0].id
}

client.spawnAndRunAll()

client.on('READY', () => {
  console.log('Ready!')
  client.post(`/applications/${DISCORD_BOT_ID}/commands`, {
    body: {
      name: '이 메시지로 상황극하기',
      type: ApplicationCommandType.MESSAGE
    } as CreateGlobalApplicationCommandPayload
  })
})

client.on('INTERACTION_CREATE', async (_, interaction) => {
  const data = interaction.data as
    | ApplicationCommandInteractionDataPayload
    | undefined
  if (data?.name === '이 메시지로 상황극하기') {
    const msgs = data.resolved?.messages
    if (msgs) {
      const msg = msgs[Object.keys(msgs)[0]]
      if (msg) {
        let channelID = msg.channel_id
        if (interaction.guild_id !== undefined) {
          const thread = await client.post<GuildThreadChannelPayload>(
            `/channels/${msg.channel_id}/messages/${msg.id}/threads`,
            {
              body: {
                name: '진실의 방'
              }
            }
          )
          channelID = thread.id
        }
        const thread: Thread = await openAI.request({
          method: 'POST',
          url: '/threads',
          headers: {
            'OpenAI-Beta': 'assistants=v1'
          }
        })
        listeningChannels[channelID] = {
          threadID: thread.id
        }
        await client.post(
          `/interactions/${interaction.id}/${interaction.token}/callback`,
          {
            body: {
              type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `<#${channelID}> 에서 대화를 시작합니다!`
              }
            } as InteractionResponsePayload
          }
        )
        await createResponse(channelID, msg.content!)
      }
    }
  }
})

client.on('MESSAGE_CREATE', async (_, msg) => {
  if (
    listeningChannels[msg.channel_id] !== undefined &&
    msg.author.id !== DISCORD_BOT_ID
  ) {
    if (msg.content !== undefined) {
      await createResponse(msg.channel_id, msg.content)
    }
  }
})
