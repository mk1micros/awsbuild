# resource "aws_lb" "application-lb" {
#   provider           = aws.region-master
#   name               = "test-lb"
#   internal           = false
#   load_balancer_type = "application"
#   security_groups    = [aws_security_group.lb-sg.id]
#   subnets            = [aws_subnet.subnet_1.id, aws_subnet.subnet_2.id]
#   tags = {
#     Name = "test-LB"
#   }
#   drop_invalid_header_fields = true
# }


# data "aws_lb" "web_alb" {
#   name = "web-alb"  # Replace with the name of your existing ALB
# }

# module "privatedns" {
#     source = "./modules/private_dns"
#     dns_zone = "test"
#     vpc_id = aws_vpc.vpc_master.id
#     vpc_id2 = aws_vpc.vpc_ireland.id
  
# }

#  module "core_dns" {
#      source = "./modules/external_dns"
#      dns_name = var.dns_name
#      dns_record = "test"
#      alb_dns_name = data.aws_lb.web_alb.dns_name
# 	 alb_zone_id = data.aws_lb.web_alb.zone_id
  
#  }
resource "aws_s3_object" "file_upload" {
	bucket = "mk1web"
	key = "cloudformation.yaml"
	source = "./cloudformation/cloudformation.yaml"
	acl = "private"
}