provider "aws" {
  region = "eu-west-2"
}

# Reference existing VPC and subnets
data "aws_vpc" "main" {
  id = "vpc-08f57de659bbb5071"  # Replace with the ID of your existing VPC
}

data "aws_subnet" "subnet_1" {
  id = "subnet-077c97160c5cf7506"  # Replace with the ID of your existing subnet 1
}

data "aws_subnet" "subnet_2" {
  id = "subnet-0a1262f87991bede6"  # Replace with the ID of your existing subnet 2
}

data "aws_security_group" "web_sg" {
  id = "sg-0aea8ae3b9a5be12c"  # Replace with the ID of your existing security group
}

data "aws_ecr_repository" "mk1micros" {
  name = "mk1micros" # Replace with your actual ECR repository name
}

# ALB (Application Load Balancer)
resource "aws_lb" "web_alb" {
  name               = "web-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [data.aws_security_group.web_sg.id]
  subnets            = [data.aws_subnet.subnet_1.id, data.aws_subnet.subnet_2.id]
}

# Target Group for the ALB
resource "aws_lb_target_group" "web_target_group" {
  name        = "web-target-group"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
    matcher             = "200-399"
  }
}

# ALB Listener
resource "aws_lb_listener" "web_listener" {
  load_balancer_arn = aws_lb.web_alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web_target_group.arn
  }
}

# Fetch the existing ACM certificate by domain name
#data "aws_acm_certificate" "mk1micros_cert" {
#  domain   = "test.mk1micros.co.uk"  # The domain name for your certificate
#  most_recent = true  # Ensure that we get the most recent certificate if there are multiple
#  statuses = ["ISSUED"]  # Only select certificates that are issued
#}

# ALB Listener for HTTPS (Port 443)
#resource "aws_lb_listener" "web_listener_https" {
#  load_balancer_arn = aws_lb.web_alb.arn
#  port              = 443
#  protocol          = "HTTPS"

#  ssl_policy        = "ELBSecurityPolicy-2016-08"  # Or another recommended policy
#  certificate_arn   = data.aws_acm_certificate.mk1micros_cert.arn  # ACM SSL certificate ARN

#  default_action {
#    type             = "forward"
#    target_group_arn = aws_lb_target_group.web_target_group.arn
#  }
#}

# ECS Cluster
resource "aws_ecs_cluster" "web_cluster" {
  name = "web-cluster"
}

# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecsTaskExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Attach managed policies to the ECS task execution role
resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy_1" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy_2" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# IAM Role for ECS Task
resource "aws_iam_role" "ecs_task_role" {
  name = "ecs-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [ 
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# ECS Task Definition
resource "aws_ecs_task_definition" "web_task" {
  family                   = "web-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([{
    name      = "mk1micros-container"
    image     = "${data.aws_ecr_repository.mk1micros.repository_url}:latest"  # Replace with your image or ECR URL
    essential = true
    portMappings = [{
      containerPort = 80
      hostPort      = 80
      protocol      = "tcp"
    }]
  }])
}
resource "aws_service_discovery_private_dns_namespace" "web_namespace" {
  name        = "production" # Replace with your preferred namespace
  vpc         = data.aws_vpc.main.id
  description = "Service discovery namespace for web service"
}

resource "aws_service_discovery_service" "web_discovery_service" {
  name = "roduction-service" # Service name registered in the namespace
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.web_namespace.id
    dns_records {
      type  = "A"   # Use "A" for IPv4, "AAAA" for IPv6
      ttl   = 60    # Time to live for DNS records
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

# ECS Fargate Service
resource "aws_ecs_service" "web_service" {
  name            = "web-service"
  cluster         = aws_ecs_cluster.web_cluster.id
  task_definition = aws_ecs_task_definition.web_task.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [data.aws_subnet.subnet_1.id, data.aws_subnet.subnet_2.id]
    security_groups  = [data.aws_security_group.web_sg.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web_target_group.arn
    container_name   = "mk1micros-container"
    container_port   = 80
  }
  service_registries {
    registry_arn = aws_service_discovery_service.web_discovery_service.arn
  }

  depends_on = [
    aws_lb_listener.web_listener,  # Ensure ALB listener is ready
    aws_lb_target_group.web_target_group  # Ensure target group is ready
  ]
}

# Output: ALB DNS Name
output "load_balancer_url" {
  value = aws_lb.web_alb.dns_name
}
