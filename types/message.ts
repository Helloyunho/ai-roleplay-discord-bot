export interface Message {
  id: string
  role: 'user' | 'assistant'
  thread_id: string
  assistant_id: string
  content: [
    {
      type: 'text' | 'image'
      text?: {
        value: string
      }
      image_file?: {
        file_id: string
      }
    }
  ]
}

export interface CreateMessage {
  role: 'user'
  content: string
}
