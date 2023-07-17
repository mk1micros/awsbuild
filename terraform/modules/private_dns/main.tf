locals {
modernisation-platform-domain = "modernisation-platform.service.justice.gov.uk"
modernisation-platform-internal-domain = "modernisation-platform.internal"

account_names = [for key, account in var.accounts : account]
environment_id = { for key, env in var.environments : key => env }

account_numbers = concat(flatten([
for value in flatten(local.account_names) :
local.environment_id.account_ids[value]
]),
[var.modernisation_platform_account]
)

}


resource "aws_route53_zone" "private" {

name = "${var.dns_zone}.${local.modernisation-platform-internal-domain}"

vpc {
vpc_id = var.vpc_id
}

lifecycle {
ignore_changes = [vpc]
}

tags = merge(
var.tags_common,
{
Name = "${var.tags_prefix}-internal-zone"
},
)
}

resource "aws_route53_zone_association" "extend" {

zone_id = aws_route53_zone.private.zone_id
vpc_id = var.vpc_id
}