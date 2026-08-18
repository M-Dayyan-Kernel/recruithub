# Least-privilege policy for the ai-recruitment backend token.
# The app token can only READ the secret paths the backend consumes —
# it cannot write, list, or read anything else.
#   recruithub/* = deployed stack (server .env)
#   dev/*        = local dev (DEV_* overrides)
path "secret/data/recruithub/*" {
  capabilities = ["read"]
}

path "secret/data/dev/*" {
  capabilities = ["read"]
}