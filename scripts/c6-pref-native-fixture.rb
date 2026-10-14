# frozen_string_literal: true
# Isolated TEST-ONLY Chatwoot v4.18 native fixture.
# Feed on stdin to the stock Rails runner IN bp-c6poc-rails-1 only.
# Never execute against any live account, real inbox or production database.
require 'securerandom'

raise 'C6_SYNTHETIC_FIXTURE_GATE' unless ENV['BP_C6_POC_FIXTURE_GATE'] == 'isolated-synthetic-only'
raise 'C6_RAILS_ISOLATION_GUARD' unless ENV['FRONTEND_URL'] == 'http://localhost:18082'
mode = ENV.fetch('BP_C6_POC_FIXTURE_MODE')
raise 'C6_UNSUPPORTED_MODE' unless %w[setup incoming bot-echo template].include?(mode)

if mode == 'setup'
  # No native staff, team or delayed-rule installation; previously denied
  # fixtures are expressly outside this independent, narrow campaign.
  label = 'BP-C6-PREF-20261014-SYNTHETIC'
  raise 'C6_SYNTHETIC_FIXTURE_EXISTS' if Account.where(name: label).exists?
  account = Account.create!(name: label)
  channel = Channel::WebWidget.create!(account: account, website_url: 'https://synthetic.invalid')
  inbox = Inbox.create!(account: account, channel: channel,
    name: 'C6 PRE-FIX Synthetic Website', enable_email_collect: true)
  bot = AgentBot.create!(account: account, name: 'C6 PRE-FIX Synthetic AgentBot',
    outgoing_url: 'http://127.0.0.1:3107/api/first-line/agentbot/webhook')
  bot.update!(secret: SecureRandom.hex(32))
  AgentBotInbox.create!(inbox: inbox, agent_bot: bot, status: :active)
  raise 'C6_UNPROVEN_NATIVE_BOT_SECRET' unless bot.secret.match?(/\A[a-f0-9]{64}\z/)
  raise 'C6_UNPROVEN_NATIVE_BOT_TOKEN' unless bot.access_token&.token.to_s.match?(/\A[A-Za-z0-9_-]{16,128}\z/)
  raise 'C6_BOT_INBOX_NOT_CONNECTED' unless inbox.reload.agent_bot&.id == bot.id
  puts "BP_C6_POC_RESULT=#{account.id}|#{inbox.id}|#{bot.id}|#{bot.access_token.token}|#{bot.secret}"
else
  account_id = Integer(ENV.fetch('BP_C6_POC_ACCOUNT_ID'))
  inbox_id = Integer(ENV.fetch('BP_C6_POC_INBOX_ID'))
  bot_id = Integer(ENV.fetch('BP_C6_POC_BOT_ID'))
  account = Account.find(account_id)
  inbox = Inbox.find(inbox_id)
  bot = AgentBot.find(bot_id)
  raise 'C6_ACCOUNT_NOT_SYNTHETIC' unless account.name == 'BP-C6-PREF-20261014-SYNTHETIC'
  raise 'C6_INBOX_NOT_IN_SYNTHETIC_ACCOUNT' unless inbox.account_id == account.id
  raise 'C6_BOT_NOT_BOUND_TO_INBOX' unless bot.account_id == account.id && inbox.agent_bot&.id == bot.id
  raise 'C6_BOT_NOT_ACTIVE' unless inbox.agent_bot_inbox&.active?
  contact = Contact.create!(account: account, name: 'SYNTHETIC C6 POC CONTACT')
  contact_inbox = ContactInbox.create!(contact: contact, inbox: inbox, source_id: "bp-c6-pref-#{SecureRandom.hex(12)}")
  conversation = Conversation.create!(account: account, inbox: inbox, contact: contact,
    contact_inbox: contact_inbox)
  raise 'C6_NATIVE_BOT_NOT_OWNER' unless conversation.pending? &&
    conversation.ai_assignee_type == 'AgentBot' && conversation.assignee_agent_bot_id == bot.id
  message_args = { account: account, inbox: inbox, conversation: conversation,
    content: 'SYNTHETIC C6 TEST CONTENT', content_type: :text }
  case mode
  when 'incoming'
    message_args[:sender] = contact
    message_args[:message_type] = :incoming
  when 'bot-echo'
    message_args[:sender] = bot
    message_args[:message_type] = :outgoing
  when 'template'
    message_args[:sender] = nil
    message_args[:message_type] = :template
  end
  message = Message.create!(**message_args)
  puts "BP_C6_POC_CASE=#{mode}|#{conversation.id}|#{message.id}"
end
