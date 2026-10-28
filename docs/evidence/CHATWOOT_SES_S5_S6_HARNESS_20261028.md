# BabyPark Chatwoot 4.18.0 — isolated S5/S6 synthetic test harness (2026-10-28)

Status: EVIDENCE — NON-NORMATIVE; disposable test source only, never production code or automatic rollout.
Applies to: SES Email Continuity S5/S6 synthetic test lab for Chatwoot v4.18.0; repository `Stanislavikus/babypark-integration`.
Supersedes: none.

This is the **exact test source**, copied from the isolated rehearsal host after execution. Source `sha256sum` values are from the remote test host, not a fresh independent reviewer. All fixture addresses use reserved `.invalid`; do not substitute buyer records, real SMTP credentials, or real customer email. The Compose file requires **newly created disposable** `test_db_password`, `test_secret_key_base`, and a `lab.env` holding the corresponding test-only `POSTGRES_PASSWORD`/`SECRET_KEY_BASE`. Those secret values are intentionally not preserved here.

Isolation: dedicated Docker Compose project `bp-ses-s5s6-20261028a`, internal-only network, no published port, distinct disposable Postgres, Redis and ActiveStorage volume, exact local Docker image digests: Chatwoot `sha256:03a03a85a00f1d119367deb0d090a56e553468d0aa5e9194a57eba7c61deb7de`, PostgreSQL `sha256:a97d77306ff47cc1d8add4d000cec2207da2e110746318df3137ce53c337ca30`, Redis `sha256:ca0acbb137c1dc3339c8b147a58fd6f42775d4599327b50e7b116c23de501af2`. Rails `db:prepare` first; then scripts executed in the order below. For S6 mailer runs only, override `SMTP_ADDRESS=absent.fixture.invalid` for the isolated rails-runner process. Never start an external SMTP provider or attach this Compose network to production.

**Invocation:** `docker exec bp-ses-s5s6-20261028a-runner-1 bundle exec rails runner /lab_evidence/<script>.rb`; supply the fake SMTP env override only to S6 jobs needing it. Test runbook and observed outputs are in `docs/CHATWOOT_SES_S5_S6_ISOLATED_RESULT_20261028.md`. Files are embedded as plain evidence, **not authorized to execute on production**.

## `compose.yaml` — observed source SHA-256 `53691178c9e0734bd75c5fcfe93b80377be2fd70525043be25b5b700408fe50b`

```yaml
name: bp-ses-s5s6-20261028a
services:
  db:
    image: pgvector/pgvector@sha256:a97d77306ff47cc1d8add4d000cec2207da2e110746318df3137ce53c337ca30
    environment:
      POSTGRES_USER: test_only
      POSTGRES_DB: chatwoot_s5s6
      POSTGRES_PASSWORD_FILE: /run/secrets/test_db_password
    secrets: [test_db_password]
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [lab]
    mem_limit: 300m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test_only -d chatwoot_s5s6"]
      interval: 3s
      timeout: 2s
      retries: 15
  redis:
    image: redis@sha256:ca0acbb137c1dc3339c8b147a58fd6f42775d4599327b50e7b116c23de501af2
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    networks: [lab]
    mem_limit: 128m
    healthcheck:
      test: ["CMD","redis-cli","ping"]
      interval: 3s
      timeout: 2s
      retries: 15
  runner:
    image: chatwoot/chatwoot@sha256:03a03a85a00f1d119367deb0d090a56e553468d0aa5e9194a57eba7c61deb7de
    command: ["sh","-c","sleep infinity"]
    working_dir: /app
    env_file: [lab.env]
    environment:
      POSTGRES_HOST: db
      POSTGRES_PORT: "5432"
      POSTGRES_USERNAME: test_only
      POSTGRES_DATABASE: chatwoot_s5s6
      REDIS_URL: redis://redis:6379
      ACTIVE_STORAGE_SERVICE: local
      RAILS_ENV: production
      NODE_ENV: production
      INSTALLATION_ENV: docker
      FORCE_SSL: "false"
      FRONTEND_URL: http://localhost:3000
      ENABLE_ACCOUNT_SIGNUP: "false"
      RAILS_LOG_TO_STDOUT: "true"
      MAILER_SENDER_EMAIL: "synthetic@fixture.invalid"
    volumes:
      - storage:/app/storage
      - ./evidence:/lab_evidence
    networks: [lab]
    mem_limit: 1200m
    depends_on:
      db: {condition: service_healthy}
      redis: {condition: service_healthy}
networks:
  lab:
    internal: true
    attachable: false
volumes:
  pgdata:
  storage:
secrets:
  test_db_password:
    file: ./test_db_password
```

## `evidence/bootstrap_s5.rb` — observed source SHA-256 `644d970e5d35b770a642b77f9d1b3702f844b30d7515ea29a78d42d920f378d9`

```ruby
require 'json'
raise "NOT_LAB" unless ENV.fetch('POSTGRES_DATABASE') == 'chatwoot_s5s6'
raise "NOT_TEST_LOCAL_STORAGE" unless ENV.fetch('ACTIVE_STORAGE_SERVICE') == 'local'
account = Account.create!(name: 'SES-S5S6 synthetic only', support_email: 'support@fixture.invalid')
channel = Channel::WebWidget.create!(account: account, website_url: 'https://fixture.invalid', continuity_via_email: true)
inbox = Inbox.create!(account: account, name: 'SES-S5S6 Synthetic Website', channel: channel, enable_auto_assignment: false, enable_email_collect: false)
contact = Contact.create!(account: account, name: 'S5 synthetic contact', email: 'contact@fixture.invalid')
ci = ContactInbox.create!(contact: contact, inbox: inbox, source_id: 'synthetic-s5-contact-inbox')
conversation = Conversation.create!(account: account, inbox: inbox, contact: contact, contact_inbox: ci)
mail = "From: fixture-sender@fixture.invalid\r\nTo: reply+#{conversation.uuid}@reply.fixture.invalid\r\nMessage-ID: <s5-01@fixture.invalid>\r\nSubject: S5 synthetic only\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nSynthetic hello; not a buyer email.\r\n"
ie = ActionMailbox::InboundEmail.create_and_extract_message_id!(mail)
puts JSON.generate({status:"S5_ACCEPTED_SYNTHETIC", ids:{account:account.id,inbox:inbox.id,contact:contact.id,conversation:conversation.id,inbound_email:ie.id}, app_version: File.read('/app/VERSION_CW').strip, queued_action_mailbox_routing:Sidekiq::Queue.new('action_mailbox_routing').count, inbound_status:ie.status, raw_blob_present:ie.raw_email.attached?, messages_in_conversation:conversation.messages.count, hmac_mandatory:channel.hmac_mandatory})
```

## `evidence/execute_s5.rb` — observed source SHA-256 `09fd4ce872a8ddd151ac68646a9c0c7b8dc442f3da3d179aac3acbe241c0fa67`

```ruby
require 'json'
raise "NOT_LAB" unless ENV.fetch('POSTGRES_DATABASE') == 'chatwoot_s5s6'
raise "NOT_TEST_VERSION" unless File.read('/app/VERSION_CW').strip == '4.18.0'
ie = ActionMailbox::InboundEmail.find(1)
conversation = Conversation.find(1)
raise 'NOT_FIXTURE' unless conversation.contact.email == 'contact@fixture.invalid'
results = {test: 'S5', version: '4.18.0', isolated: true, fixture_inbound_id: ie.id}
results[:before] = {status: ie.status, raw_blob: ie.raw_email.attached?, message_count: conversation.messages.count, queued_default: Sidekiq::Queue.new('default').count}
module SyntheticS5Fault
  def add_attachments_to_message
    raise 'SYNTHETIC_FAILURE_AFTER_MESSAGE_INSERT_BEFORE_ATTACHMENTS' if $s5_inject_fail
    super
  end
end
ReplyMailbox.prepend(SyntheticS5Fault)
$s5_inject_fail = true
begin
  ActionMailbox::RoutingJob.perform_now(ie)
  results[:injected_failure] = 'UNEXPECTED_SUCCESS'
rescue => ex
  results[:injected_failure] = ex.message.include?('SYNTHETIC_FAILURE') ? 'EXPECTED_FAILURE' : "UNEXPECTED_#{ex.class}"
end
results[:after_failed] = {status: ie.reload.status, message_count: conversation.messages.count, raw_blob: ie.raw_email.attached?}
$s5_inject_fail = false
begin
  ActionMailbox::RoutingJob.perform_now(ie)
  results[:replay] = 'COMPLETED'
rescue => ex
  results[:replay] = "#{ex.class}: #{ex.message.to_s.slice(0,180)}"
end
results[:after_replay] = {status: ie.reload.status, message_count: conversation.messages.count, source_ids: conversation.messages.pluck(:source_id).compact.size, attachment_count: conversation.messages.joins(:attachments).count}
begin
  ActionMailbox::RoutingJob.perform_now(ie)
  results[:post_commit_ack_loss_replay] = 'COMPLETED'
rescue => ex
  results[:post_commit_ack_loss_replay] = "#{ex.class}: #{ex.message.to_s.slice(0,160)}"
end
results[:after_ack_loss_replay] = {status: ie.reload.status, message_count: conversation.messages.count, attachment_count: conversation.messages.joins(:attachments).count}
results[:invariant] = results.dig(:after_failed,:message_count) == 0 && results.dig(:after_replay,:message_count) == 1 && results.dig(:after_ack_loss_replay,:message_count) == 1 && ie.delivered?
puts "S5_EVIDENCE_JSON " + JSON.generate(results)
```

## `evidence/attachments_parallel_s5.rb` — observed source SHA-256 `1d8cabd8876df157fda9b04999aae4a7f55d4c50440e3d02331ccb802bd8ae6a`

```ruby
require 'json'
raise 'NOT_LAB' unless ENV.fetch('POSTGRES_DATABASE') == 'chatwoot_s5s6'
conversation=Conversation.find(1)
def fixture_mail(uuid, msgid, attachments)
  headers="From: fixture-sender@fixture.invalid\r\nTo: reply+#{uuid}@reply.fixture.invalid\r\nMessage-ID: <#{msgid}@fixture.invalid>\r\nSubject: #{msgid} synthetic\r\nMIME-Version: 1.0\r\n"
  return headers+"Content-Type: text/plain; charset=UTF-8\r\n\r\nSynthetic message.\r\n" unless attachments
  headers+"Content-Type: multipart/mixed; boundary=\"synthetic-s5-boundary\"\r\n\r\n--synthetic-s5-boundary\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nSynthetic message with synthetic attachment.\r\n--synthetic-s5-boundary\r\nContent-Type: text/plain; name=\"fixture.txt\"\r\nContent-Disposition: attachment; filename=\"fixture.txt\"\r\nContent-Transfer-Encoding: base64\r\n\r\nc3ludGhldGljIGRhdGE=\r\n--synthetic-s5-boundary--\r\n"
end
results={test:'S5_ATTACHMENTS_AND_PARALLEL',isolated:true,version:'4.18.0',conversation_id:conversation.id}
mail=fixture_mail(conversation.uuid,'s5-attach-02',true)
ie=ActionMailbox::InboundEmail.create_and_extract_message_id!(mail)
pre=conversation.messages.count
results[:attachment_pre]={inbound:ie.id,status:ie.status,pre_msg_count:pre,raw_blob:ie.raw_email.attached?}
begin
  ActionMailbox::RoutingJob.perform_now(ie)
  results[:attachment_first_processing]='COMPLETED'
rescue => e
  results[:attachment_first_processing]="#{e.class}: #{e.message.to_s.slice(0,160)}"
end
a_message=conversation.messages.find_by(source_id:'s5-attach-02@fixture.invalid')
results[:attachment_after]={status:ie.reload.status,delta_messages:conversation.messages.count-pre,exact_message_found:!!a_message,attachments:a_message&.attachments&.count}
begin
  ActionMailbox::RoutingJob.perform_now(ie)
  results[:attachment_retry]='COMPLETED'
rescue => e
  results[:attachment_retry]="#{e.class}: #{e.message.to_s.slice(0,140)}"
end
results[:attachment_after_retry]={delta_messages:conversation.messages.count-pre,attachments:a_message&.reload&.attachments&.count}
results[:attachment_invariant]=results.dig(:attachment_after,:delta_messages)==1 && results.dig(:attachment_after,:attachments)==1 && results.dig(:attachment_after_retry,:delta_messages)==1 && results.dig(:attachment_after_retry,:attachments)==1

mail2=fixture_mail(conversation.uuid,'s5-parallel-03',false)
ie2=ActionMailbox::InboundEmail.create_and_extract_message_id!(mail2)
pre2=conversation.messages.count
barrier=Queue.new
go=Queue.new
threads=2.times.map do
 Thread.new do
   barrier << true
   go.pop
   begin
     ActiveRecord::Base.connection_pool.with_connection do
       ActionMailbox::RoutingJob.perform_now(ActionMailbox::InboundEmail.find(ie2.id))
     end
     'COMPLETED'
   rescue => e
     "#{e.class}: #{e.message.to_s.slice(0,90)}"
   end
 end
end
2.times{barrier.pop}
2.times{go << true}
results[:parallel_results]=threads.map(&:value)
results[:parallel_after]={status:ie2.reload.status,delta_messages:conversation.messages.count-pre2,matched_source_ids:conversation.messages.where(source_id:'s5-parallel-03@fixture.invalid').count}
results[:parallel_no_duplicate]=results.dig(:parallel_after,:matched_source_ids)==1 && results.dig(:parallel_after,:delta_messages)==1
puts 'S5_ATTACH_PARALLEL_EVIDENCE_JSON '+JSON.generate(results)
```

## `evidence/execute_s6.rb` — observed source SHA-256 `49bb837507e26a4e9ceffa7d5a12c64f4025f7635fff6dbba8edd02045074d75`

```ruby
require 'json'
raise 'NOT_LAB' unless ENV.fetch('POSTGRES_DATABASE') == 'chatwoot_s5s6'
raise 'NOT_VERSION' unless File.read('/app/VERSION_CW').strip == '4.18.0'
raise 'NOT_FAKE_SMTP' unless ENV['SMTP_ADDRESS'] == 'absent.fixture.invalid'
account = Account.find(1)
account.update!(domain:'reply.fixture.invalid',support_email:'support@fixture.invalid')
conversation = Conversation.find(1)
channel = conversation.inbox.channel
channel.update!(continuity_via_email: true)
m = Message.create!(account: account, inbox:conversation.inbox,conversation:conversation, message_type: :outgoing, content: 'S6 SYNTHETIC ONLY - no real customer content')
pending = Sidekiq::ScheduledSet.new.to_a.select{|j| j.klass.to_s.include?('ConversationReplyEmailJob') || j.args.inspect.include?('ConversationReplyEmailJob') }
results = {test:'S6', isolated:true, version:'4.18.0', synthetic_message_id:m.id, scheduled_continuity_jobs_before_off:pending.length, flag_before_off:channel.continuity_via_email}
channel.update!(continuity_via_email:false)
results[:flag_after_off]=channel.reload.continuity_via_email
results[:mailer_jobs_before_first_stage]=Sidekiq::Queue.new('mailers').map{|j| j.klass}.tally
begin
  ConversationReplyEmailJob.perform_now(conversation.id,m.id)
  results[:first_stage_after_flag_off]='COMPLETED'
rescue => e
  results[:first_stage_after_flag_off]="#{e.class}:#{e.message.to_s.slice(0,180)}"
end
mailer = Sidekiq::Queue.new('mailers').to_a
results[:mailer_jobs_after_first_stage]=mailer.map{|j| {wrapped:j.klass, aj_class:j.args.dig(0,'job_class') || j.item.dig('args',0,'job_class') }}
results[:second_stage_present]=mailer.any?{|j| j.args.inspect.include?('ActionMailer::MailDeliveryJob') || j.klass.to_s.include?('ActionMailer::MailDeliveryJob')}
results[:no_external_smtp_sent]=true # no sidekiq worker, isolated Docker internal network, no SMTP receiver
results[:first_stage_off_does_not_stop_queued_second_stage]= results[:flag_after_off] == false && results[:first_stage_after_flag_off] == 'COMPLETED' && results[:second_stage_present]
puts 'S6_EVIDENCE_JSON '+JSON.generate(results)
```

## `evidence/finish_s6.rb` — observed source SHA-256 `1fbf56d1249703fb5901b2116bb2888470de1ac0633dd51c792b576c6f9feafe`

```ruby
require 'json'
raise 'NOT_LAB' unless ENV.fetch('POSTGRES_DATABASE') == 'chatwoot_s5s6'
raise 'NOT_FAKE_SMTP' unless ENV['SMTP_ADDRESS'] == 'absent.fixture.invalid'
raise 'NOT_VERSION' unless File.read('/app/VERSION_CW').strip == '4.18.0'
conv=Conversation.find(1)
raise 'CONTINUITY_STILL_ON' unless conv.inbox.channel.continuity_via_email == false
queue=Sidekiq::Queue.new('default')
target=queue.find{|j| j.args.any?{|a| a.is_a?(Hash) && a['job_class']=='ActionMailer::MailDeliveryJob' && a['arguments'].inspect.include?('ConversationReplyMailer')}}
raise 'MISSING_MAIL_DELIVERY_JOB' unless target
payload=target.args.first
raise 'TARGET_MAILER_MISMATCH' unless payload['arguments'].first=='ConversationReplyMailer'
ActionMailer::Base.delivery_method=:test
ActionMailer::Base.deliveries.clear
result={test:'S6_SECOND_STAGE',version:'4.18.0',isolated:true,flag_off:true,queue:target.queue,wrapped:target.klass,job_class:payload['job_class'],message_delivery_job_found:true,queue_size_before:queue.count}
begin
  ActiveJob::Base.execute(payload)
  result[:job_execution]='COMPLETED'
rescue => e
  result[:job_execution]="#{e.class}: #{e.message.to_s.slice(0,160)}"
end
result[:test_mail_deliveries]=ActionMailer::Base.deliveries.size
result[:sent_only_to_fixture]=ActionMailer::Base.deliveries.all?{|m| m.to == ['contact@fixture.invalid']}
result[:queue_size_after]=queue.count
result[:invariant]=result[:job_execution]=='COMPLETED' && result[:test_mail_deliveries]==1 && result[:sent_only_to_fixture]
puts 'S6_SECOND_STAGE_EVIDENCE_JSON '+JSON.generate(result)
```

## `evidence/flag_gating_s6.rb` — observed source SHA-256 `79e0f746b5dedfe4496f56ee37634e409bd537d881a5166d5c537286280415e9`

```ruby
require 'json'
raise 'NOT_LAB' unless ENV.fetch('POSTGRES_DATABASE')=='chatwoot_s5s6'
conversation=Conversation.find(1)
channel=conversation.inbox.channel
account=conversation.account
def count_continuity
  Sidekiq::ScheduledSet.new.count{|j|j.item.inspect.include?('ConversationReplyEmailJob')}
end
r={test:'S6_FLAG_GATING',isolated:true,version:File.read('/app/VERSION_CW').strip}
channel.update!(continuity_via_email:false)
before=count_continuity
off=Message.create!(account:account,inbox:conversation.inbox,conversation:conversation,message_type: :outgoing,content:'S6 OFF synthetic only')
Messages::SendEmailNotificationService.new(message:off).perform
r[:off]={flag:false,before:before,after:count_continuity}
channel.update!(continuity_via_email:true)
on=Message.create!(account:account,inbox:conversation.inbox,conversation:conversation,message_type: :outgoing,content:'S6 ON synthetic only')
on_before=count_continuity
Messages::SendEmailNotificationService.new(message:on).perform
r[:on]={flag:true,before:on_before,after:count_continuity}
channel.update!(continuity_via_email:false)
r[:scheduled_after_turning_off]=count_continuity
r[:off_blocks_new_jobs]=r.dig(:off,:after)==r.dig(:off,:before)
r[:on_schedules_delayed_job]=r.dig(:on,:after)>r.dig(:on,:before)
r[:off_does_not_cancel_previously_scheduled]=r[:scheduled_after_turning_off]==r.dig(:on,:after)
puts 'S6_FLAG_EVIDENCE_JSON '+JSON.generate(r)
```

