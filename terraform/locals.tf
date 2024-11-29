locals {
	app_name = "value"
	env_name = "value"
	tags = merge(
	{"is-production" = "false"},
	{"source-code" = "https://github.com/mk1micros/awsbuild"}

	)
}
